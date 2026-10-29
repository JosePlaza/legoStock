// Cliente de la API de BrickLink (OAuth 1.0a firmado con HMAC-SHA1).
// Claves en .env: BRICKLINK_CONSUMER_KEY, BRICKLINK_CONSUMER_SECRET, BRICKLINK_TOKEN_VALUE, BRICKLINK_TOKEN_SECRET
import crypto from 'node:crypto';
import { cached, HOUR, DAY } from './api-cache.js';

const BASE = (process.env.BRICKLINK_API_BASE || 'https://api.bricklink.com/api/store/v1').replace(/\/+$/, '');
const env = k => (process.env[k] || '').trim().replace(/^['"]|['"]$/g, '');
const KEYS = () => ({
  ck: env('BRICKLINK_CONSUMER_KEY'), cs: env('BRICKLINK_CONSUMER_SECRET'),
  tv: env('BRICKLINK_TOKEN_VALUE'), ts: env('BRICKLINK_TOKEN_SECRET'),
});
export const configured = () => Object.values(KEYS()).every(v => v.length > 5);

const enc = s => encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());

export function oauthHeader(method, url, query = {}, k = KEYS(), { nonce, timestamp } = {}) {
  const oauth = {
    oauth_consumer_key: k.ck,
    oauth_token: k.tv,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(timestamp ?? Math.floor(Date.now() / 1000)),
    oauth_nonce: nonce ?? crypto.randomBytes(12).toString('hex'),
    oauth_version: '1.0',
  };
  const all = { ...query, ...oauth };
  const paramStr = Object.keys(all).sort().map(key => `${enc(key)}=${enc(String(all[key]))}`).join('&');
  const base = [method.toUpperCase(), enc(url), enc(paramStr)].join('&');
  const sig = crypto.createHmac('sha1', `${enc(k.cs)}&${enc(k.ts)}`).update(base).digest('base64');
  return 'OAuth realm="", ' + Object.entries({ ...oauth, oauth_signature: sig }).map(([a, b]) => `${a}="${enc(b)}"`).join(', ');
}

const ERRORS = {
  TOKEN_IP_MISMATCHED: 'La IP desde la que llamas no coincide con la registrada en tu token de BrickLink. Edita el token en bricklink.com y pon la IP 0.0.0.0 (cualquiera) o tu IP pública actual.',
  BAD_OAUTH_REQUEST: 'Las claves de BrickLink no son correctas (revisa las 4 del .env).',
  INVALID_SIGNATURE: 'La firma no es válida: revisa CONSUMER_SECRET y TOKEN_SECRET en el .env.',
};

export async function blGet(path, query = {}) {
  if (!configured()) { const e = new Error('BrickLink no está configurado: faltan las claves en .env'); e.code = 'no_bricklink'; throw e; }
  const url = BASE + path;
  const clean = Object.fromEntries(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== ''));
  const qs = new URLSearchParams(clean).toString();
  const res = await fetch(url + (qs ? '?' + qs : ''), { headers: { Authorization: oauthHeader('GET', url, clean), Accept: 'application/json' } });
  const body = await res.json().catch(() => null);
  const code = body?.meta?.code;
  if (!body || (code && code !== 200)) {
    const m = body?.meta || {};
    const known = Object.keys(ERRORS).find(k => (m.message || '').includes(k) || (m.description || '').includes(k));
    const e = new Error(known ? ERRORS[known] : `BrickLink: ${m.description || m.message || res.statusText}`);
    e.code = code === 404 || /NOT_FOUND/i.test(m.message || '') ? 'not_found' : 'bricklink';
    throw e;
  }
  return body.data;
}

// Tipo de BrickLink: SET, PART, MINIFIG…  Los sets llevan sufijo -1 si no lo traen.
export const normalizeSet = n => (/^\d+$/.test(String(n).trim()) ? `${String(n).trim()}-1` : String(n).trim());

export async function getItem(type, no) {
  return cached(`bl:item:${type}:${no}`, 7 * DAY, () => blGet(`/items/${type}/${encodeURIComponent(no)}`));
}

export async function knownColors(no) {
  return cached(`bl:colors:PART:${no}`, 7 * DAY, async () => ({ list: await blGet(`/items/PART/${encodeURIComponent(no)}/colors`) }));
}

// Resumen de un bloque de la guía de precios
function summarize(d, guide) {
  const lots = d?.price_detail || [];
  const shipping = guide === 'stock' ? lots.filter(l => l.shipping_available === true || l.shipping_available === 'Y') : lots;
  const n = x => (x == null || x === '' ? null : Number(x));
  return {
    min: n(d?.min_price), max: n(d?.max_price), avg: n(d?.avg_price), qty_avg: n(d?.qty_avg_price),
    lots: d?.unit_quantity ?? lots.length, units: d?.total_quantity ?? null,
    min_ship: shipping.length ? Math.min(...shipping.map(l => Number(l.unit_price))) : null,
    currency: d?.currency_code || null,
  };
}

// Guía de precios: Nuevo/Usado × (tu país, UE, mundo) en stock ahora + vendidos últimos 6 meses (mundo)
export async function priceGuide(type, no, { color, country = 'ES', currency = 'EUR', force = false } = {}) {
  const key = `bl:price:${type}:${no}:${color || ''}:${country}:${currency}`;
  return cached(key, 12 * HOUR, async () => {
    const base = { color_id: color, currency_code: currency, vat: 'Y' };
    const scopes = { country: { country_code: country }, eu: { region: 'eu' }, world: {} };
    const jobs = [];
    for (const cond of ['N', 'U']) {
      for (const [scope, q] of Object.entries(scopes)) jobs.push([cond, scope, 'stock', { ...base, ...q, guide_type: 'stock', new_or_used: cond }]);
      jobs.push([cond, 'world', 'sold', { ...base, guide_type: 'sold', new_or_used: cond }]);
    }
    const out = { N: { stock: {}, sold: {} }, U: { stock: {}, sold: {} } };
    for (const [cond, scope, guide, q] of jobs) {
      try { out[cond][guide][scope] = summarize(await blGet(`/items/${type}/${encodeURIComponent(no)}/price`, q), guide); }
      catch (e) { if (e.code !== 'not_found') throw e; out[cond][guide][scope] = null; }
    }
    return { type, no, color: color || null, country, currency, guide: out };
  }, { force });
}

export const blImage = (type, no, color) => type === 'SET'
  ? `https://img.bricklink.com/ItemImage/SN/0/${no}.png`
  : type === 'MINIFIG' ? `https://img.bricklink.com/ItemImage/MN/0/${no}.png`
    : `https://img.bricklink.com/ItemImage/PN/${color || 0}/${no}.png`;

export const blUrl = (type, no, color) => {
  const t = { SET: 'S', PART: 'P', MINIFIG: 'M' }[type] || 'P';
  return `https://www.bricklink.com/v2/catalog/catalogitem.page?${t}=${encodeURIComponent(no)}${color ? `#T=S&C=${color}` : ''}`;
};
