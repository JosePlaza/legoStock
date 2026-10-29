// Cliente de la API de BrickOwl: tiendas que venden un set o pieza, con precio, estado y país.
// Clave en .env: BRICKOWL_API_KEY (brickowl.com → My Account → API Keys).
// Ojo: "catalog/availability" exige que BrickOwl apruebe la clave para el catálogo.
import { cached, HOUR, DAY } from './api-cache.js';

const BASE = (process.env.BRICKOWL_API_BASE || 'https://api.brickowl.com/v1').replace(/\/+$/, '');
const KEY = () => (process.env.BRICKOWL_API_KEY || '').trim().replace(/^['"]|['"]$/g, '');
export const configured = () => KEY().length > 10;

export const CONDITIONS = {
  new: ['N', 'Nuevo'], news: ['N', 'Nuevo precintado'], newc: ['N', 'Nuevo completo'], newi: ['N', 'Nuevo incompleto'],
  usedc: ['U', 'Usado completo'], usedi: ['U', 'Usado incompleto'], usedn: ['U', 'Usado como nuevo'],
  usedg: ['U', 'Usado bueno'], useda: ['U', 'Usado aceptable'], other: ['U', 'Otro'],
};

async function boGet(path, query = {}) {
  if (!configured()) { const e = new Error('BrickOwl no está configurado: falta BRICKOWL_API_KEY en .env'); e.code = 'no_brickowl'; throw e; }
  const qs = new URLSearchParams({ key: KEY(), ...Object.fromEntries(Object.entries(query).filter(([, v]) => v != null && v !== '')) });
  const res = await fetch(`${BASE}${path}?${qs}`, { headers: { Accept: 'application/json' } });
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* no es JSON */ }
  const msg = body?.error?.status || body?.error || body?.message || (!res.ok ? `${res.status} ${res.statusText}` : null);
  if (!res.ok || (body && body.error)) {
    const m = String(typeof msg === 'object' ? JSON.stringify(msg) : msg || 'error');
    const e = new Error(/approv|permission|not allowed|access/i.test(m)
      ? 'Tu clave de BrickOwl no tiene permiso para consultar el catálogo. Pide la «catalog approval» a BrickOwl (brickowl.com → Contact / API).'
      : /key/i.test(m) ? 'La clave de BrickOwl no es válida.' : `BrickOwl: ${m}`);
    e.code = res.status === 404 ? 'not_found' : 'brickowl';
    throw e;
  }
  return body;
}

// Número de set / pieza / elemento LEGO -> BOID de BrickOwl
export async function boidFor(type, id, idType) {
  const t = type === 'SET' ? 'Set' : type === 'MINIFIG' ? 'Minifigure' : 'Part';
  const r = await cached(`bo:idl:${t}:${idType || ''}:${id}`, 30 * DAY, async () => ({ boids: (await boGet('/catalog/id_lookup', { id, type: t, id_type: idType })).boids || [] }));
  return r.boids[0] || null;
}

// Lotes a la venta (máx. 400) enviables a `country`
export async function availability(boid, country = 'ES', { force = false } = {}) {
  const r = await cached(`bo:av:${boid}:${country}`, 6 * HOUR, async () => {
    const data = await boGet('/catalog/availability', { boid, country });
    return { lots: Object.values(data || {}) };
  }, { force });
  return r;
}
