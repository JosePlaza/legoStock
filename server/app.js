// La API (Express) sin arrancar: la usan server/index.js en local y api/index.js en Vercel.
import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import * as repo from './db.js';
import { compare, resolveForStock } from './rebrickable.js';
import * as projects from './projects.js';
import * as migration from './migrate.js';
import { startSync, job as syncJob, importCatalog, pullFromSupabase, pullIfStale, startRemoteSync, remoteJob, getChanges, lastRemoteRun, nextSyncAt } from './lego-sync.js';
import { requireAuth, configured, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase.js';
import { refreshStock, adjustStock, adjustBulk, getColorMap, setColorMap, effectiveColorMap, getSettings, saveSettings } from './userdata.js';
import * as market from './market.js';
import * as wishlist from './wishlist.js';

if (repo.isCatalogEmpty() && fs.existsSync(repo.CATALOG_FILE)) {
  const r = repo.upsertCatalog(JSON.parse(fs.readFileSync(repo.CATALOG_FILE, 'utf8')));
  console.log(`Catálogo cargado desde data/catalog.json: ${r.designs} piezas, ${r.elements} variantes de color`);
}
if (!configured) console.warn('⚠️  Supabase sin configurar: rellena SUPABASE_URL y SUPABASE_ANON_KEY en .env (mira .env.example)');

export const app = express();
app.use('/api/catalog/import', express.json({ limit: '30mb' }));
app.use(express.json({ limit: '1mb' }));
app.use(express.text({ type: ['text/csv', 'text/plain', 'application/csv', 'application/vnd.ms-excel'], limit: '20mb' }));

// Rutas públicas
app.get('/api/config', (req, res) => res.json({ configured, url: configured ? SUPABASE_URL : null, anonKey: configured ? SUPABASE_ANON_KEY : null }));

// Todo lo demás requiere sesión
app.use('/api', requireAuth);
// En Vercel la base local empieza vacía en cada arranque: antes de responder traemos el catálogo de Supabase.
if (repo.SERVERLESS) app.use('/api', async (req, res, next) => { await pullIfStale(); next(); });

const wrap = fn => async (req, res, next) => {
  try {
    const out = await fn(req, res);
    if (out === undefined) return;
    if (out === null) return res.status(404).json({ error: 'No encontrado' });
    res.json(out);
  } catch (e) { next(e); }
};
const csvBody = req => (typeof req.body === 'string' ? req.body : '');
const uid = req => req.user.id;

// El catálogo es compartido por todas las cuentas: solo lo cambian los correos de ADMIN_EMAILS (separados por comas).
// Sin la variable, en local puede cualquiera y en Vercel nadie.
const ADMINS = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
const isAdmin = req => (ADMINS.length ? ADMINS.includes(String(req.user.email || '').toLowerCase()) : !repo.SERVERLESS);
const adminOnly = (req, res, next) => (isAdmin(req) ? next()
  : res.status(403).json({ code: 'forbidden', error: 'Solo quien administra el catálogo puede actualizarlo (ADMIN_EMAILS).' }));

app.get('/api/me', wrap(req => ({ id: req.user.id, email: req.user.email })));

// ----- Catálogo -----
app.get('/api/meta', wrap(async req => {
  await refreshStock(req, req.query.fresh === '1');
  if (req.query.fresh === '1') await pullFromSupabase();
  const meta = repo.getMeta(uid(req));
  meta.catalog.nextSyncAt = nextSyncAt();
  meta.catalog.canManage = isAdmin(req);
  meta.catalog.remoteRun = await lastRemoteRun(req.sb).catch(() => null);
  return meta;
}));
app.get('/api/designs', wrap(async req => { await refreshStock(req); return repo.listDesigns(uid(req), { ...req.query, owned: req.query.owned === '1' }); }));
app.get('/api/designs/:id', wrap(async req => { await refreshStock(req); return repo.getDesign(uid(req), req.params.id); }));
app.post('/api/catalog/import', adminOnly, wrap(req => importCatalog(req.body)));
app.post('/api/catalog/sync', adminOnly, wrap(() => (repo.SERVERLESS ? startRemoteSync() : startSync())));
app.get('/api/catalog/sync', wrap(() => (repo.SERVERLESS ? remoteJob() : syncJob)));
app.get('/api/catalog/changes', wrap(async req => {
  await refreshStock(req);
  return getChanges(uid(req), Number(req.query.sync) || null, { type: req.query.type || null, limit: Number(req.query.limit) || 300 });
}));

// ----- Stock -----
app.post('/api/stock', wrap(async (req, res) => {
  const { design_id, color_id, delta, qty } = req.body || {};
  if (!design_id || !color_id) { res.status(400); return { error: 'Faltan design_id o color_id' }; }
  const newQty = await adjustStock(req, design_id, color_id, { delta, qty });
  return { qty: newQty, design: repo.getDesign(uid(req), design_id) };
}));

// ----- Rebrickable (comparación suelta) -----
app.post('/api/rebrickable/compare', wrap(async req => {
  await refreshStock(req);
  return compare(csvBody(req), { spares: req.query.spares === '1' }, { uid: uid(req), colorMap: await effectiveColorMap(req) });
}));
app.post('/api/rebrickable/add-to-stock', wrap(async req => {
  const { items, skipped } = resolveForStock(csvBody(req), { spares: req.query.spares === '1' }, await effectiveColorMap(req));
  await adjustBulk(req, items, 'rebrickable');
  return { added: items.reduce((s, i) => s + i.delta, 0), lots: items.length, skipped };
}));
app.get('/api/rebrickable/color-map', wrap(req => getColorMap(req)));
app.put('/api/rebrickable/color-map', wrap(req => setColorMap(req, req.body.rb, req.body.lego)));

// ----- Proyectos -----
app.get('/api/projects', wrap(req => projects.list(req)));
app.post('/api/projects', wrap(req => projects.create(req, {
  csv: csvBody(req), name: req.query.name, filename: req.query.filename, include_spares: req.query.spares === '1',
})));
app.get('/api/projects/:id', wrap(req => projects.detail(req, req.params.id)));
app.patch('/api/projects/:id', wrap(req => projects.update(req, req.params.id, req.body || {})));
app.put('/api/projects/:id/csv', wrap(req => projects.update(req, req.params.id, { csv: csvBody(req), filename: req.query.filename })));
app.delete('/api/projects/:id', wrap(async req => { await projects.remove(req, req.params.id); return { ok: true }; }));
app.post('/api/projects/:id/add-to-stock', wrap(req => projects.addAllToStock(req, req.params.id)));
app.get('/api/projects/:id/files', wrap(req => projects.files(req, req.params.id)));
// El navegador sube el archivo directamente a Supabase Storage (Vercel no admite cuerpos de más de 4,5 MB)
// y aquí solo se registra.
app.post('/api/projects/:id/files', wrap(req => projects.registerFile(req, req.params.id, req.body || {})));
app.delete('/api/projects/:id/files/:fid', wrap(async req => { await projects.deleteFile(req, req.params.id, req.params.fid); return { ok: true }; }));

// ----- Ajustes, búsqueda (Rebrickable + BrickLink) y wishlist -----
app.get('/api/integrations', wrap(() => market.integrations()));
app.get('/api/settings', wrap(req => getSettings(req)));
app.put('/api/settings', wrap(req => saveSettings(req, req.body || {})));
app.get('/api/search', wrap(req => market.search(req, { type: req.query.type, q: req.query.q, page: Number(req.query.page) || 1 })));
app.get('/api/item/:type/:no', wrap(req => market.itemDetail(req, String(req.params.type).toUpperCase(), req.params.no, { color: req.query.color, force: req.query.force === '1' })));
app.get('/api/wishlist', wrap(req => wishlist.list(req)));
app.post('/api/wishlist', wrap(req => wishlist.add(req, req.body || {})));
app.patch('/api/wishlist/:id', wrap(req => wishlist.update(req, req.params.id, req.body || {})));
app.delete('/api/wishlist/:id', wrap(async req => { await wishlist.remove(req, req.params.id); return { ok: true }; }));
app.post('/api/wishlist/:id/refresh', wrap(req => wishlist.refresh(req, req.params.id)));
app.post('/api/wishlist/:id/project', wrap(req => wishlist.toProject(req, req.params.id)));

// ----- Importación de los datos locales anteriores -----
app.get('/api/migration', wrap(req => migration.status(req)));
app.post('/api/migration', wrap(req => migration.run(req)));

export function handleErrors(err, req, res, _next) {
  console.error(err);
  res.status(err.status || 400).json({ error: err.message || 'Error', code: err.code });
}
