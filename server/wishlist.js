// Wishlist de sets (Supabase): datos del set, PVP, precio objetivo, precios de BrickLink y % que ya tienes.
import * as bl from './bricklink.js';
import * as rb from './rebrickable-api.js';
import { compare } from './rebrickable.js';
import { check } from './supabase.js';
import { getSettings } from './userdata.js';
import { ctx as projectCtx, create as createProject } from './projects.js';
import { bestOffers, brickowlOffers, combineBest } from './market.js';
import * as bo from './brickowl.js';

const now = () => new Date().toISOString();

async function decorate(req, rows) {
  const settings = await getSettings(req);
  let c = null;
  try { c = await projectCtx(req, rows.map(w => w.inventory_csv).filter(Boolean)); } catch (e) { console.warn('[wishlist] sin % de piezas:', e.message); }
  return rows.map(w => {
    let summary = null;
    if (w.inventory_csv && c) { try { summary = compare(w.inventory_csv, {}, c).summary; } catch { /* csv raro */ } }
    const { inventory_csv, ...rest } = w;
    let best = null;
    try { best = combineBest(bestOffers(w.prices, settings), w.prices?.brickowl?.offers); } catch (e) { console.warn('[wishlist] precios:', e.message); }
    const cheapest = [best?.N?.total, best?.U?.total].filter(x => x != null);
    return {
      ...rest, has_inventory: !!inventory_csv, summary, best,
      bl_url: bl.blUrl('SET', w.set_num),
      below_target: w.target_price != null && cheapest.some(x => x <= Number(w.target_price)),
    };
  });
}

export async function list(req) {
  const rows = check(await req.sb.from('wishlist').select('*').eq('user_id', req.user.id).order('created_at', { ascending: false }));
  return decorate(req, rows);
}

async function getRow(req, id) {
  return check(await req.sb.from('wishlist').select('*').eq('id', Number(id)).limit(1))[0] || null;
}

async function enrich(req, setNum, { force = false } = {}) {
  const out = {}, warnings = [];
  if (rb.configured()) {
    try { const s = await rb.getSet(setNum); Object.assign(out, { name: s.name, year: s.year, theme: s.theme, num_parts: s.num_parts, img_url: s.img }); } catch (e) { warnings.push(e.message); }
    try { out.inventory_csv = await rb.setInventoryCsv(setNum); } catch (e) { warnings.push('Inventario: ' + e.message); }
  }
  const s = await getSettings(req);
  const prices = {};
  if (bo.configured()) {
    try {
      const r = await brickowlOffers('SET', { no: setNum, settings: s, force });
      prices.brickowl = { offers: r.offers.slice(0, 40), count: r.offers.length, at: now() };
    } catch (e) { warnings.push('BrickOwl: ' + e.message); }
  }
  if (bl.configured()) {
    if (!out.name) { try { const it = await bl.getItem('SET', setNum); Object.assign(out, { name: it.name, year: it.year_released, img_url: bl.blImage('SET', setNum) }); } catch (e) { warnings.push(e.message); } }
    try {
      const p = await bl.priceGuide('SET', setNum, { country: s.country, currency: s.currency, force });
      delete p._cachedAt;
      Object.assign(prices, p);
    } catch (e) { warnings.push('BrickLink: ' + e.message); }
  }
  if (Object.keys(prices).length) Object.assign(out, { prices, prices_at: now() });
  return { data: out, warnings };
}

export async function add(req, body) {
  const set_num = bl.normalizeSet(body.set_num || '');
  if (!/^[\w-]+$/.test(set_num)) throw new Error('Número de set no válido');
  const exists = check(await req.sb.from('wishlist').select('*').eq('user_id', req.user.id).eq('set_num', set_num).limit(1))[0];
  if (exists) return { item: (await decorate(req, [exists]))[0], warnings: ['Ese set ya estaba en tu wishlist'], existed: true };
  const { data, warnings } = await enrich(req, set_num);
  const row = {
    user_id: req.user.id, set_num,
    name: body.name || data.name || set_num,
    year: data.year ?? (body.year ? Number(body.year) : null), theme: data.theme ?? body.theme ?? null,
    num_parts: data.num_parts ?? (body.num_parts ? Number(body.num_parts) : null),
    img_url: data.img_url || body.img_url || `https://img.bricklink.com/ItemImage/SN/0/${set_num}.png`,
    rrp: body.rrp === '' || body.rrp == null ? null : Number(body.rrp),
    target_price: body.target_price === '' || body.target_price == null ? null : Number(body.target_price),
    inventory_csv: data.inventory_csv || null, prices: data.prices || null, prices_at: data.prices_at || null,
  };
  const saved = check(await req.sb.from('wishlist').insert(row).select('*'))[0];
  return { item: (await decorate(req, [saved]))[0], warnings };
}

const EDITABLE = ['name', 'year', 'theme', 'num_parts', 'img_url', 'rrp', 'target_price', 'status', 'notes'];
export async function update(req, id, fields) {
  const patch = { updated_at: now() };
  for (const k of EDITABLE) if (fields[k] !== undefined) patch[k] = ['rrp', 'target_price', 'year', 'num_parts'].includes(k) ? (fields[k] === '' || fields[k] == null ? null : Number(fields[k])) : fields[k];
  const rows = check(await req.sb.from('wishlist').update(patch).eq('id', Number(id)).select('*'));
  if (!rows[0]) throw new Error('No encontrado');
  return (await decorate(req, rows))[0];
}

export async function refresh(req, id) {
  const w = await getRow(req, id);
  if (!w) throw new Error('No encontrado');
  const { data, warnings } = await enrich(req, w.set_num, { force: true });
  const patch = { updated_at: now() };
  if (data.prices) { patch.prices = data.prices; patch.prices_at = data.prices_at; }
  if (data.inventory_csv) patch.inventory_csv = data.inventory_csv;
  for (const k of ['year', 'theme', 'num_parts']) if (w[k] == null && data[k] != null) patch[k] = data[k];
  const rows = check(await req.sb.from('wishlist').update(patch).eq('id', Number(id)).select('*'));
  return { item: (await decorate(req, rows))[0], warnings };
}

export async function remove(req, id) {
  check(await req.sb.from('wishlist').delete().eq('id', Number(id)));
}

export async function toProject(req, id) {
  const w = await getRow(req, id);
  if (!w) throw new Error('No encontrado');
  if (!w.inventory_csv) throw new Error('No tengo el inventario de este set (hace falta la clave de Rebrickable)');
  const p = await createProject(req, { csv: w.inventory_csv, name: `${w.set_num} ${w.name}`.trim(), filename: `${w.set_num}.csv` });
  check(await req.sb.from('wishlist').update({ project_id: p.id, updated_at: now() }).eq('id', w.id));
  return p;
}
