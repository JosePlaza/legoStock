import { accessToken, sb } from './supabase.js';

// Todas las peticiones a la API llevan el token de la sesión de Supabase
async function j(url, opts = {}) {
  const token = await accessToken();
  const headers = { ...(opts.headers || {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  const r = await fetch(url, { ...opts, headers });
  const body = await r.json().catch(() => ({}));
  if (r.status === 401) window.dispatchEvent(new CustomEvent('auth:expired'));
  if (!r.ok) { const e = new Error(body.error || r.statusText); e.code = body.code; throw e; }
  return body;
}
const json = (method, data) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });

// Los archivos de proyecto van directos del navegador a Supabase Storage (la API en Vercel no acepta
// cuerpos de más de 4,5 MB) y después se apuntan en el proyecto a través de la API.
const storageKey = n => String(n || 'archivo').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w.\-]+/g, '_').slice(0, 100);
async function uploadFile(id, file, { cover } = {}) {
  if (cover && !file.type.startsWith('image/')) throw new Error('La portada tiene que ser una imagen (JPG, PNG, WEBP…)');
  const { data } = await sb().auth.getSession();
  if (!data.session) { window.dispatchEvent(new CustomEvent('auth:expired')); throw new Error('Inicia sesión'); }
  const mime = file.type || 'application/octet-stream';
  const path = `${data.session.user.id}/${Number(id)}/${Date.now()}-${storageKey(file.name)}`;
  const { error } = await sb().storage.from('project-files').upload(path, file, { contentType: mime, upsert: false });
  if (error) throw new Error(/exceeded|too large|payload/i.test(error.message) ? `El archivo es demasiado grande para Supabase Storage (${error.message})` : error.message);
  return j(`/api/projects/${id}/files`, json('POST', { path, filename: file.name, mime, size: file.size, cover: !!cover }));
}

export const api = {
  meta: fresh => j('/api/meta' + (fresh ? '?fresh=1' : '')),
  migrationStatus: () => j('/api/migration'),
  runMigration: () => j('/api/migration', { method: 'POST' }),
  designs: params => j('/api/designs?' + new URLSearchParams(params)),
  design: id => j('/api/designs/' + encodeURIComponent(id)),
  stock: body => j('/api/stock', json('POST', body)),
  importCatalog: text => j('/api/catalog/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: text }),
  compare: (csv, spares) => j('/api/rebrickable/compare?spares=' + (spares ? 1 : 0), { method: 'POST', headers: { 'Content-Type': 'text/csv' }, body: csv }),
  addToStock: (csv, spares) => j('/api/rebrickable/add-to-stock?spares=' + (spares ? 1 : 0), { method: 'POST', headers: { 'Content-Type': 'text/csv' }, body: csv }),
  setColorMap: (rb, lego) => j('/api/rebrickable/color-map', json('PUT', { rb, lego })),
  // Catálogo
  startSync: () => j('/api/catalog/sync', { method: 'POST' }),
  syncStatus: () => j('/api/catalog/sync'),
  syncs: () => j('/api/catalog/syncs'),
  changes: params => j('/api/catalog/changes?' + new URLSearchParams(params || {})),
  // Búsqueda, precios y wishlist
  integrations: () => j('/api/integrations'),
  settings: () => j('/api/settings'),
  saveSettings: s => j('/api/settings', json('PUT', s)),
  search: params => j('/api/search?' + new URLSearchParams(params)),
  item: (type, no, params) => j(`/api/item/${type}/${encodeURIComponent(no)}?` + new URLSearchParams(params || {})),
  wishlist: () => j('/api/wishlist'),
  addWish: body => j('/api/wishlist', json('POST', body)),
  updateWish: (id, f) => j('/api/wishlist/' + id, json('PATCH', f)),
  deleteWish: id => j('/api/wishlist/' + id, { method: 'DELETE' }),
  refreshWish: id => j(`/api/wishlist/${id}/refresh`, { method: 'POST' }),
  wishToProject: id => j(`/api/wishlist/${id}/project`, { method: 'POST' }),
  // Proyectos
  projects: () => j('/api/projects'),
  project: id => j('/api/projects/' + id),
  createProject: (csv, { name, filename, spares }) => j('/api/projects?' + new URLSearchParams({ name: name || '', filename: filename || '', spares: spares ? 1 : 0 }),
    { method: 'POST', headers: { 'Content-Type': 'text/csv' }, body: csv }),
  updateProject: (id, fields) => j('/api/projects/' + id, json('PATCH', fields)),
  replaceCsv: (id, csv, filename) => j(`/api/projects/${id}/csv?filename=` + encodeURIComponent(filename || ''), { method: 'PUT', headers: { 'Content-Type': 'text/csv' }, body: csv }),
  deleteProject: id => j('/api/projects/' + id, { method: 'DELETE' }),
  projectToStock: id => j(`/api/projects/${id}/add-to-stock`, { method: 'POST' }),
  uploadFile,
  deleteFile: (id, fid) => j(`/api/projects/${id}/files/${fid}`, { method: 'DELETE' }),
};

export const setImg = setNum => (setNum ? `https://cdn.rebrickable.com/media/sets/${setNum}.jpg` : null);
// Portada de un proyecto: imagen subida > foto del set en Rebrickable > pieza más usada
export const projectCover = (p, coverElement) => p.cover_url || setImg(p.set_num) || img(coverElement);
// Enlace firmado de Supabase Storage forzando la descarga con su nombre
export const downloadUrl = f => (f.url ? f.url + (f.url.includes('?') ? '&' : '?') + 'download=' + encodeURIComponent(f.filename) : '#');
export const fmtDate = d => (d ? new Date(d).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
export const fmtSize = b => (b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');

// Imágenes servidas directamente por el CDN de LEGO (se cargan desde tu navegador).
export const img = (elementId, size = 192) =>
  elementId ? `https://www.lego.com/cdn/product-assets/element.img.photoreal.${size}x${size}/${elementId}.jpg` : PLACEHOLDER;

export const PLACEHOLDER = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect x='6' y='26' width='52' height='26' rx='4' fill='%23d9dde3'/%3E%3Crect x='14' y='16' width='12' height='12' rx='3' fill='%23d9dde3'/%3E%3Crect x='38' y='16' width='12' height='12' rx='3' fill='%23d9dde3'/%3E%3C/svg%3E";
export const onImgError = e => { if (e.target.src !== PLACEHOLDER) e.target.src = PLACEHOLDER; };

export const eur = cents => (cents == null ? '—' : (cents / 100).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' }));
export const num = n => Number(n || 0).toLocaleString('es-ES');

export const swatchBg = c => {
  if (!c) return '#ccc';
  if (c.family === 'Multicombination') return 'conic-gradient(#e3000b, #fac80a, #1e5aa8, #00852b, #e3000b)';
  if (/^tr\.|transparent/i.test(c.name)) return `linear-gradient(135deg, ${c.hex} 0 50%, ${c.hex}99 50% 100%)`;
  return c.hex || '#ccc';
};

// Variante (color) que se muestra por defecto en una tarjeta.
export function pickVariant(design, preferColor) {
  const v = design.variants || [];
  const most = [...v].sort((a, b) => b.qty - a.qty)[0];
  return (preferColor && v.find(x => x.color_id === preferColor))
    || (most && most.qty > 0 ? most : null)
    || v.find(x => x.available)
    || v[0]
    || { element_id: null, color_id: '0', price_cents: null, qty: 0, available: 0 };
}

export const money = (v, cur = 'EUR') => (v == null || v === '' ? '—' : Number(v).toLocaleString('es-ES', { style: 'currency', currency: cur || 'EUR' }));
export const SCOPES = { country: 'Tu país', eu: 'Unión Europea', world: 'Todo el mundo' };
