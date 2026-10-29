// Datos de cada usuario guardados en Supabase (stock, movimientos y colores asignados).
import * as repo from './db.js';
import { check } from './supabase.js';
import { legoColorMap } from './rebrickable-api.js';

const fresh = new Map(); // user_id -> timestamp de la última copia a stock_cache
const TTL = 60_000;

// Lee todas las filas (Supabase devuelve como mucho 1000 por petición)
export async function fetchAll(build) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const rows = check(await build().range(from, from + 999));
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

export async function refreshStock(req, force = false) {
  const uid = req.user.id;
  const t = fresh.get(uid);
  if (!force && t && Date.now() - t < TTL) return;
  const rows = await fetchAll(() => req.sb.from('stock').select('design_id, color_id, qty').eq('user_id', uid).gt('qty', 0).order('design_id').order('color_id'));
  repo.replaceStockCache(uid, rows);
  fresh.set(uid, Date.now());
}

export async function adjustStock(req, design, color, { delta, qty } = {}, source = 'manual') {
  const params = {
    p_design: String(design), p_color: String(color),
    p_delta: delta == null || delta === '' ? null : Math.floor(Number(delta) || 0),
    p_qty: qty == null || qty === '' ? null : Math.max(0, Math.floor(Number(qty) || 0)),
    p_source: source,
  };
  const n = check(await req.sb.rpc('adjust_stock', params));
  repo.setStockCache(req.user.id, design, color, n);
  return n;
}

export async function adjustBulk(req, items, source = 'bulk') {
  for (let i = 0; i < items.length; i += 300) {
    check(await req.sb.rpc('adjust_stock_bulk', { p_items: items.slice(i, i + 300), p_source: source }));
  }
  await refreshStock(req, true);
}

export async function getColorMap(req) {
  const rows = check(await req.sb.from('rb_color_map').select('rb_color, lego_color_id').eq('user_id', req.user.id));
  return Object.fromEntries(rows.map(r => [r.rb_color, r.lego_color_id]));
}

export async function setColorMap(req, rb, lego) {
  if (!lego) check(await req.sb.from('rb_color_map').delete().eq('user_id', req.user.id).eq('rb_color', String(rb)));
  else check(await req.sb.from('rb_color_map').upsert({ user_id: req.user.id, rb_color: String(rb), lego_color_id: String(lego) }, { onConflict: 'user_id,rb_color' }));
  return getColorMap(req);
}

// Mapa de colores a usar al comparar: lo que asignaste a mano manda sobre lo que dice Rebrickable
export async function effectiveColorMap(req) {
  return { ...(await legoColorMap()), ...(await getColorMap(req)) };
}

// ----- Ajustes del usuario (país, divisa, envío estimado) -----
export const DEFAULT_SETTINGS = { country: 'ES', currency: 'EUR', ship_domestic: 5, ship_eu: 12, ship_world: 25 };
export async function getSettings(req) {
  let rows = [];
  try { rows = check(await req.sb.from('user_settings').select('*').eq('user_id', req.user.id).limit(1)); }
  catch (e) { console.warn('[ajustes] uso los valores por defecto:', e.message); }
  const r = rows[0] || {};
  const out = { ...DEFAULT_SETTINGS };
  for (const k of Object.keys(DEFAULT_SETTINGS)) if (r[k] != null) out[k] = typeof DEFAULT_SETTINGS[k] === 'number' ? Number(r[k]) : r[k];
  return out;
}
export async function saveSettings(req, s) {
  const row = { user_id: req.user.id, updated_at: new Date().toISOString() };
  if (s.country) row.country = String(s.country).toUpperCase().slice(0, 2);
  if (s.currency) row.currency = String(s.currency).toUpperCase().slice(0, 3);
  for (const k of ['ship_domestic', 'ship_eu', 'ship_world']) if (s[k] != null && s[k] !== '') row[k] = Math.max(0, Number(s[k]) || 0);
  check(await req.sb.from('user_settings').upsert(row, { onConflict: 'user_id' }));
  return getSettings(req);
}
