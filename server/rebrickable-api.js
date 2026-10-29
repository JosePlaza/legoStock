// Cliente de la API de Rebrickable (búsqueda de sets y piezas por nombre, inventarios, colores).
// Clave gratuita en rebrickable.com → Profile → Settings → API. En .env: REBRICKABLE_API_KEY
import { cached, DAY } from './api-cache.js';

const BASE = (process.env.REBRICKABLE_API_BASE || 'https://rebrickable.com/api/v3').replace(/\/+$/, '');
const KEY = () => (process.env.REBRICKABLE_API_KEY || '').trim().replace(/^['"]|['"]$/g, '');
export const configured = () => KEY().length > 10;

let last = 0;
async function rbGet(path, query = {}) {
  if (!configured()) { const e = new Error('Rebrickable no está configurado: falta REBRICKABLE_API_KEY en .env'); e.code = 'no_rebrickable'; throw e; }
  const wait = 1100 - (Date.now() - last); // Rebrickable pide ~1 petición por segundo
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  last = Date.now();
  const qs = new URLSearchParams(Object.fromEntries(Object.entries(query).filter(([, v]) => v !== undefined && v !== ''))).toString();
  const res = await fetch(`${BASE}${path}${qs ? '?' + qs : ''}`, { headers: { Authorization: `key ${KEY()}`, Accept: 'application/json' } });
  if (res.status === 404) { const e = new Error('No existe en Rebrickable'); e.code = 'not_found'; throw e; }
  if (res.status === 401 || res.status === 403) throw new Error('La clave de Rebrickable no es válida');
  if (res.status === 429) throw new Error('Rebrickable: demasiadas peticiones seguidas, espera unos segundos');
  if (!res.ok) throw new Error(`Rebrickable: ${res.status} ${res.statusText}`);
  return res.json();
}

const themeName = async id => {
  if (!id) return null;
  try { return (await cached(`rb:theme:${id}`, 30 * DAY, () => rbGet(`/lego/themes/${id}/`))).name; } catch { return null; }
};

export async function searchSets(q, page = 1) {
  const r = await cached(`rb:search:sets:${q.toLowerCase()}:${page}`, DAY, () => rbGet('/lego/sets/', { search: q, page_size: 24, page, ordering: '-year' }));
  return { count: r.count, next: !!r.next, results: r.results.map(s => ({ type: 'SET', no: s.set_num, name: s.name, year: s.year, num_parts: s.num_parts, theme_id: s.theme_id, img: s.set_img_url })) };
}

export async function searchParts(q, page = 1) {
  const r = await cached(`rb:search:parts:${q.toLowerCase()}:${page}`, DAY, () => rbGet('/lego/parts/', { search: q, page_size: 24, page }));
  return { count: r.count, next: !!r.next, results: r.results.map(p => ({ type: 'PART', no: p.part_num, name: p.name, img: p.part_img_url, bl_no: p.external_ids?.BrickLink?.[0] || p.part_num })) };
}

export async function getSet(setNum) {
  const s = await cached(`rb:set:${setNum}`, 7 * DAY, () => rbGet(`/lego/sets/${encodeURIComponent(setNum)}/`));
  return { type: 'SET', no: s.set_num, name: s.name, year: s.year, num_parts: s.num_parts, theme: await themeName(s.theme_id), img: s.set_img_url, url: s.set_url };
}

export async function getPart(partNum) {
  const p = await cached(`rb:part:${partNum}`, 7 * DAY, () => rbGet(`/lego/parts/${encodeURIComponent(partNum)}/`));
  return { type: 'PART', no: p.part_num, name: p.name, img: p.part_img_url, url: p.part_url, bl_no: p.external_ids?.BrickLink?.[0] || p.part_num, year_from: p.year_from, year_to: p.year_to };
}

// Colores de Rebrickable con su id equivalente en BrickLink
export async function colors() {
  const r = await cached('rb:colors', 30 * DAY, async () => {
    const out = [];
    let page = 1, more = true;
    while (more) { const x = await rbGet('/lego/colors/', { page_size: 500, page }); out.push(...x.results); more = !!x.next; page++; }
    return { list: out.map(c => ({ id: String(c.id), name: c.name, rgb: c.rgb, bl: c.external_ids?.BrickLink?.ext_ids?.[0] ?? null, lego: c.external_ids?.LEGO?.ext_ids?.[0] ?? null })) };
  });
  return r.list;
}

export async function partColors(partNum) {
  const r = await cached(`rb:partcolors:${partNum}`, 7 * DAY, () => rbGet(`/lego/parts/${encodeURIComponent(partNum)}/colors/`, { page_size: 500 }));
  const all = Object.fromEntries((await colors()).map(c => [c.id, c]));
  return r.results.map(c => ({ rb: String(c.color_id), name: c.color_name, num_sets: c.num_sets, img: c.part_img_url, elements: c.elements || [], bl: all[c.color_id]?.bl ?? null, lego: all[c.color_id]?.lego ?? null, rgb: all[c.color_id]?.rgb ?? null }));
}

// Inventario de un set como CSV compatible con los proyectos (incluye Element ID para coincidencia exacta)
export async function setInventoryCsv(setNum) {
  const r = await cached(`rb:setparts:${setNum}`, 30 * DAY, async () => {
    const rows = [];
    let page = 1, more = true;
    while (more) {
      const x = await rbGet(`/lego/sets/${encodeURIComponent(setNum)}/parts/`, { page_size: 1000, page, inc_minifig_parts: 1 });
      rows.push(...x.results.map(it => [it.part.part_num, it.color.id, it.quantity, it.is_spare ? 'True' : 'False', it.element_id || '']));
      more = !!x.next; page++;
    }
    return { rows };
  });
  return ['Part,Color,Quantity,Is Spare,Element ID', ...r.rows.map(x => x.join(','))].join('\n');
}

// Correspondencia color Rebrickable -> color LEGO sacada de la propia API (más completa que la lista fija)
export async function legoColorMap() {
  if (!configured()) return {};
  try {
    return Object.fromEntries((await colors()).filter(c => c.lego != null).map(c => [c.id, String(c.lego)]));
  } catch { return {}; }
}

// Datos de varias piezas de golpe (con sus números equivalentes en LEGO). Se guardan 30 días por pieza.
import { db as _db } from './db.js';
export async function resolveParts(nums) {
  const out = {};
  if (!configured() || !nums.length) return out;
  const get = _db.prepare('SELECT value, at FROM api_cache WHERE key = ?');
  const put = _db.prepare('INSERT OR REPLACE INTO api_cache (key, value, at) VALUES (?, ?, ?)');
  const missing = [];
  for (const n of nums) {
    const hit = get.get(`rb:pinfo:${n}`);
    if (hit && Date.now() - hit.at < 30 * DAY) { const v = JSON.parse(hit.value); if (v) out[n] = v; }
    else missing.push(n);
  }
  for (let i = 0; i < missing.length; i += 100) {
    const chunk = missing.slice(i, i + 100);
    let results = [];
    try { results = (await rbGet('/lego/parts/', { part_nums: chunk.join(','), page_size: 100, inc_part_details: 1 })).results || []; }
    catch (e) { console.warn('[rebrickable] piezas:', e.message); break; }
    const found = new Map(results.map(p => [p.part_num, p]));
    for (const n of chunk) {
      const p = found.get(n);
      const v = p ? { name: p.name, img: p.part_img_url || null, lego: (p.external_ids?.LEGO || []).map(String), bl: p.external_ids?.BrickLink || [] } : null;
      put.run(`rb:pinfo:${n}`, JSON.stringify(v), Date.now());
      if (v) out[n] = v;
    }
  }
  return out;
}
