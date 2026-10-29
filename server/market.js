// Búsqueda de sets/piezas (Rebrickable) y precios de mercado (BrickLink) con envío estimado.
import * as repo from './db.js';
import * as bl from './bricklink.js';
import * as rb from './rebrickable-api.js';
import * as bo from './brickowl.js';
import { rates, convert } from './fx.js';
import { cached, DAY } from './api-cache.js';
import { getSettings, refreshStock } from './userdata.js';

export const integrations = () => ({ bricklink: bl.configured(), rebrickable: rb.configured(), brickowl: bo.configured() });

const EU = new Set('AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE'.split(' '));
export const scopeOf = (country, home) => (country === home ? 'country' : EU.has(country) && EU.has(home) ? 'eu' : 'world');
const shipFor = (scope, s) => ({ country: s.ship_domestic, eu: s.ship_eu, world: s.ship_world }[scope]);

// Tiendas de BrickOwl que venden el artículo, con precio en tu divisa y envío estimado
export async function brickowlOffers(type, { no, elementId, settings, force = false }) {
  const boid = type === 'SET' ? await bo.boidFor('SET', no, 'set_number')
    : elementId ? await bo.boidFor('PART', elementId, 'item_no') : await bo.boidFor('PART', no, 'design_id');
  if (!boid) return { boid: null, offers: [], note: 'BrickOwl no tiene este artículo' };
  const [{ lots, _cachedAt }, fx] = await Promise.all([bo.availability(boid, settings.country, { force }), rates(settings.currency)]);
  const offers = lots.filter(l => l.open !== false).map(l => {
    const [cond, cond_label] = bo.CONDITIONS[l.con] || ['U', l.con || '¿?'];
    const price = convert(Number(l.price), l.base_currency, fx);
    const scope = scopeOf(String(l.country || '').toUpperCase(), settings.country);
    const shipping = shipFor(scope, settings);
    return {
      source: 'brickowl', store: l.store_name, store_url: l.store_url, url: l.url, country: l.country, scope,
      cond, cond_label, qty: Number(l.qty) || 0, price, price_orig: Number(l.price), currency_orig: l.base_currency,
      shipping, total: price == null ? null : Math.round((price + shipping) * 100) / 100,
      feedback: Number(l.feedback_count) || 0, min_order: Number(l.minimum_order) || 0, updated: l.updated || null,
    };
  }).sort((a, b) => (a.total ?? 1e12) - (b.total ?? 1e12));
  return { boid, offers, cachedAt: _cachedAt, fxDate: fx.date };
}

// Mejor de cada estado entre BrickLink (guía) y BrickOwl (tiendas)
export function combineBest(blBest, offers) {
  const out = {};
  for (const cond of ['N', 'U']) {
    const cands = [];
    if (blBest?.[cond]) cands.push({ ...blBest[cond], source: 'bricklink' });
    const o = (offers || []).find(x => x.cond === cond && x.total != null);
    if (o) cands.push({ scope: o.scope, price: o.price, shipping: o.shipping, total: o.total, source: 'brickowl', store: o.store, url: o.url, cond_label: o.cond_label });
    out[cond] = cands.sort((a, b) => a.total - b.total)[0] || null;
  }
  return out;
}

// Mejor oferta por estado (N/U) sumando el envío estimado según de dónde sea el vendedor
export function bestOffers(prices, s) {
  if (!prices?.guide) return null;
  const ship = { country: s.ship_domestic, eu: s.ship_eu, world: s.ship_world };
  const out = {};
  for (const cond of ['N', 'U']) {
    let best = null;
    for (const scope of ['country', 'eu', 'world']) {
      const g = prices.guide[cond]?.stock?.[scope];
      const price = g?.min_ship ?? g?.min;
      if (price == null) continue;
      const total = Math.round((price + ship[scope]) * 100) / 100;
      if (!best || total < best.total) best = { scope, price, shipping: ship[scope], total, avg: g.avg, lots: g.lots };
    }
    out[cond] = best;
  }
  return out;
}

const blColors = async () => (await cached('bl:colors:all', 30 * DAY, async () => ({ list: await bl.blGet('/colors') }))).list;

export async function search(req, { type = 'SET', q = '', page = 1 }) {
  q = String(q).trim();
  if (!q) return { results: [], count: 0 };
  const isNum = /^\d{3,7}(-\d{1,2})?$/.test(q);
  let out = { results: [], count: 0, next: false, source: null, notice: null };
  if (rb.configured()) {
    out = { ...(type === 'SET' ? await rb.searchSets(q, page) : await rb.searchParts(q, page)), source: 'rebrickable' };
    if (type === 'SET' && isNum && page == 1 && !out.results.some(r => r.no === bl.normalizeSet(q))) {
      try { out.results.unshift({ ...(await rb.getSet(bl.normalizeSet(q))) }); } catch { /* no existe */ }
    }
  } else {
    out.source = 'bricklink';
    out.notice = 'Sin clave de Rebrickable solo se puede buscar por número.';
    if (type === 'PART') {
      const local = repo.listDesigns(req.user.id, { q, limit: 24 });
      out.results = local.items.map(d => ({ type: 'PART', no: d.design_id, name: d.name, img: d.variants[0] ? `https://www.lego.com/cdn/product-assets/element.img.photoreal.192x192/${d.variants[0].element_id}.jpg` : null, bl_no: d.design_id }));
      out.count = local.total;
      out.notice = 'Sin clave de Rebrickable busco las piezas en el catálogo de Pick a Brick.';
    } else if (isNum && bl.configured()) {
      try { const it = await bl.getItem('SET', bl.normalizeSet(q)); out.results = [{ type: 'SET', no: it.no, name: it.name, year: it.year_released, img: bl.blImage('SET', it.no) }]; out.count = 1; } catch { /* no existe */ }
    }
  }
  // Marcas útiles: lo que ya tienes (piezas) o tienes en la wishlist (sets)
  await refreshStock(req);
  if (type === 'PART') for (const r of out.results) r.owned = repo.getDesignQty(req.user.id, r.bl_no || r.no) || repo.getDesignQty(req.user.id, r.no);
  return out;
}

export async function itemDetail(req, type, no, { color, force } = {}) {
  type = type === 'PART' ? 'PART' : type === 'MINIFIG' ? 'MINIFIG' : 'SET';
  const settings = await getSettings(req);
  const warnings = [];
  let info = null, colors = null, blNo = no, blColor = null;

  if (type === 'SET') {
    no = bl.normalizeSet(no); blNo = no;
    if (rb.configured()) { try { info = await rb.getSet(no); } catch (e) { warnings.push(e.message); } }
    if (!info && bl.configured()) {
      try { const it = await bl.getItem('SET', no); info = { type, no: it.no, name: it.name, year: it.year_released, img: bl.blImage('SET', it.no) }; } catch (e) { warnings.push(e.message); }
    }
  } else {
    if (rb.configured()) {
      try {
        info = await rb.getPart(no); blNo = info.bl_no || no;
        colors = (await rb.partColors(info.no)).map(c => ({ id: c.rb, name: c.name, rgb: c.rgb, bl: c.bl, lego: c.lego, img: c.img, num_sets: c.num_sets, elements: c.elements }));
      } catch (e) { warnings.push(e.message); }
    }
    if (!info && bl.configured()) {
      try {
        const it = await bl.getItem('PART', no);
        info = { type, no: it.no, name: it.name, img: bl.blImage('PART', it.no), bl_no: it.no };
        const names = Object.fromEntries((await blColors()).map(c => [c.color_id, c]));
        colors = (await bl.knownColors(no)).list.map(c => ({ id: String(c.color_id), bl: c.color_id, name: names[c.color_id]?.color_name || `#${c.color_id}`, rgb: names[c.color_id]?.color_code || null }));
      } catch (e) { warnings.push(e.message); }
    }
    if (colors?.length) {
      const sel = colors.find(c => String(c.id) === String(color)) || colors.slice().sort((a, b) => (b.num_sets || 0) - (a.num_sets || 0))[0];
      color = sel.id; blColor = sel.bl;
      if (sel.img && info) info.img = sel.img;
    }
  }
  if (!info) info = { type, no, name: '', img: type === 'SET' ? bl.blImage('SET', no) : null };
  info.bl_url = bl.blUrl(type, blNo, blColor);

  let prices = null;
  if (bl.configured()) {
    if (type === 'PART' && colors?.length && blColor == null) warnings.push('Este color no tiene equivalencia en BrickLink');
    else {
      try { prices = await bl.priceGuide(type, blNo, { color: blColor, country: settings.country, currency: settings.currency, force }); }
      catch (e) { warnings.push(e.message); }
    }
  }

  // Para piezas: lo que tienes y el precio en Pick a Brick (si existe allí)
  let local = null;
  if (type === 'PART') {
    await refreshStock(req);
    const d = repo.getDesign(req.user.id, blNo) || repo.getDesign(req.user.id, no);
    if (d) {
      const sel = colors?.find(c => String(c.id) === String(color));
      const v = sel?.lego ? d.variants.find(x => x.color_id === String(sel.lego)) : null;
      local = { design_id: d.design_id, total_qty: d.total_qty, variant: v || null, min_price: d.min_price };
    }
  }
  // BrickOwl: tiendas concretas
  let brickowl = null;
  if (bo.configured()) {
    try {
      const sel = colors?.find(c => String(c.id) === String(color));
      const elementId = type === 'PART' ? (local?.variant?.element_id || sel?.elements?.[0] || null) : null;
      brickowl = await brickowlOffers(type, { no: type === 'SET' ? no : blNo, elementId, settings, force });
    } catch (e) { warnings.push(e.message); brickowl = { offers: [], error: e.message }; }
  }
  const blBest = bestOffers(prices, settings);
  return { info, colors, color: color ?? null, prices, brickowl, blBest, best: combineBest(blBest, brickowl?.offers), settings, local, warnings, integrations: integrations() };
}
