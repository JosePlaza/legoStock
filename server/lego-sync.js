// Catálogo de LEGO Pick a Brick.
// - El catálogo de referencia y su historial de cambios están en Supabase (catalog_snapshot, catalog_syncs,
//   catalog_changes). Los escribe solo la Edge Function sync-catalog: cada día (pg_cron), con «Actualizar ahora»
//   y con «Importar archivo». La base local es una copia para poder buscar y filtrar con SQL.
// - «Actualizar ahora» en local lo descarga desde este ordenador y se lo pasa a la Edge Function. En Vercel no
//   se puede (la función se congela al responder), así que la Edge Function lo descarga y aquí se espera.
import * as repo from './db.js';
import { fetchCatalog } from '../supabase/functions/sync-catalog/pick-a-brick.js';
import { configured, anonClient, sbError, SUPABASE_URL } from './supabase.js';
import { fetchAll } from './userdata.js';

const LOCALE = process.env.LEGO_LOCALE || 'es-es';
const SECRET = () => (process.env.CATALOG_CRON_SECRET || '').trim();
const NO_SECRET = 'Falta CATALOG_CRON_SECRET en las variables de entorno (el mismo valor que guardaste en Supabase).';

async function callSyncFunction(trigger, body = {}) {
  if (!SECRET()) throw new Error(NO_SECRET);
  const r = await fetch(`${SUPABASE_URL}/functions/v1/sync-catalog?trigger=${trigger}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-cron-secret': SECRET() }, body: JSON.stringify(body),
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(out.error || `La Edge Function sync-catalog respondió ${r.status}`);
  return out;
}

// ---------- «Actualizar ahora» en local ----------
export const job = { running: false, page: 0, pages: 0, startedAt: null, finishedAt: null, error: null, result: null };

export function startSync(trigger = 'manual') {
  if (job.running) return job;
  Object.assign(job, { running: true, page: 0, pages: 0, startedAt: new Date().toISOString(), finishedAt: null, error: null, result: null, trigger });
  repo.setMetaValue('catalog_sync_attempted_at', job.startedAt);
  repo.setMetaValue('catalog_sync_trigger', trigger);
  repo.setMetaValue('catalog_sync_status', 'running');
  (async () => {
    try {
      const cat = await fetchCatalog({ locale: LOCALE, onProgress: (page, pages) => Object.assign(job, { page, pages }) });
      const local = repo.upsertCatalog(cat);
      repo.saveCatalogFile(cat);
      job.result = SECRET() ? (await callSyncFunction('local', { catalog: cat })).result : local;
    } catch (e) {
      job.error = e.message === 'fetch failed'
        ? `No puedo conectar con lego.com (${e.cause?.code || 'sin conexión'})`
        : e.message || String(e);
    } finally {
      job.running = false;
      job.finishedAt = new Date().toISOString();
      repo.setMetaValue('catalog_sync_status', job.error ? 'error' : 'ok');
      repo.setMetaValue('catalog_sync_error', job.error || '');
      if (job.error) console.error(`Sincronización del catálogo (${trigger}) fallida: ${job.error}`);
      else console.log(`Catálogo sincronizado (${trigger}): ${job.result.designs} piezas, ${job.result.elements} variantes`);
    }
  })();
  return job;
}

// ---------- «Importar archivo» ----------
// Con CATALOG_CRON_SECRET se guarda en Supabase (con su historial); sin él, solo en la base local.
export async function importCatalog(cat) {
  if (!SECRET() && repo.SERVERLESS) throw new Error(NO_SECRET);
  const remote = SECRET() ? (await callSyncFunction('import', { catalog: cat })).result : null;
  const local = repo.upsertCatalog(cat);
  repo.saveCatalogFile(cat);
  return remote || local;
}

// ---------- Copia local del catálogo de Supabase ----------
// El cron de Supabase corre a las 03:00 UTC (supabase/schema.sql, bloque v5).
const CHECK_EVERY_MS = 15 * 60 * 1000;
let pulling = false;

// Trae el catálogo de Supabase si es más nuevo que el local. Devuelve el resultado de upsertCatalog o null.
export async function pullFromSupabase() {
  if (!configured || pulling || job.running) return null;
  pulling = true;
  try {
    const sb = anonClient();
    const { data: head, error } = await sb.from('catalog_snapshot').select('generated_at').eq('id', 1).maybeSingle();
    if (error) throw new Error(error.message);
    const local = repo.getMetaValue('catalog_generated_at');
    if (!head || (local && new Date(head.generated_at) <= new Date(local))) return null;
    const { data: snap, error: e2 } = await sb.from('catalog_snapshot').select('data').eq('id', 1).single();
    if (e2) throw new Error(e2.message);
    const r = repo.upsertCatalog(snap.data);
    repo.saveCatalogFile(snap.data);
    repo.setMetaValue('catalog_sync_attempted_at', new Date().toISOString());
    repo.setMetaValue('catalog_sync_trigger', 'supabase');
    repo.setMetaValue('catalog_sync_status', 'ok');
    repo.setMetaValue('catalog_sync_error', '');
    console.log(`Catálogo traído de Supabase: ${r.designs} piezas, ${r.elements} variantes`);
    return r;
  } catch (e) {
    console.error(`No he podido traer el catálogo de Supabase: ${e.message}`);
    return null;
  } finally {
    pulling = false;
  }
}

// Último intento del cron de Supabase (para enseñarlo en la web).
export async function lastRemoteRun(sb) {
  const { data } = await sb.from('catalog_sync_runs')
    .select('trigger, started_at, finished_at, status, error').order('started_at', { ascending: false }).limit(1);
  return data?.[0] || null;
}

export function nextSyncAt() {
  const t = new Date();
  t.setUTCHours(3, 0, 0, 0);
  if (t <= new Date()) t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString();
}

export function watchSupabaseCatalog() {
  if (!configured) return;
  pullFromSupabase();
  setInterval(pullFromSupabase, CHECK_EVERY_MS);
}

// En Vercel no hay setInterval que valga: se comprueba al llegar peticiones, como mucho cada 15 min.
let checkedAt = 0;
export async function pullIfStale() {
  if (Date.now() - checkedAt < CHECK_EVERY_MS) return;
  checkedAt = Date.now();
  await pullFromSupabase();
}

// ---------- «Actualizar ahora» en Vercel: lo descarga la Edge Function ----------
let remoteRunId = null;

export async function startRemoteSync() {
  const out = await callSyncFunction('manual');
  remoteRunId = out.run || out.already || null;
  return remoteJob();
}

// Mismo formato que `job`, a partir del intento guardado en catalog_sync_runs.
export async function remoteJob() {
  const sb = anonClient();
  let q = sb.from('catalog_sync_runs').select('id, started_at, finished_at, status, error');
  q = remoteRunId ? q.eq('id', remoteRunId) : q.order('started_at', { ascending: false }).limit(1);
  const { data } = await q;
  const run = data?.[0];
  if (!run) return { running: false, page: 0, pages: 0, startedAt: null, finishedAt: null, error: null, result: null };
  const out = { running: run.status === 'running', page: 0, pages: 0, startedAt: run.started_at, finishedAt: run.finished_at, error: run.error, result: null };
  // Cuando trae un catálogo nuevo, la web avisa de los cambios (lo hace si finishedAt es de hace menos de 5 s).
  if (run.status === 'ok' && await pullFromSupabase()) {
    const { data: sync } = await sb.from('catalog_syncs').select('id, summary').eq('run_id', run.id).maybeSingle();
    if (sync) Object.assign(out, { result: { sync_id: sync.id, ...sync.summary }, finishedAt: new Date().toISOString() });
  }
  return out;
}

// ---------- Historial de cambios (en Supabase) ----------
const TYPES = { nuevo: 'new', agotado: 'soldout', repuesto: 'restocked', precio: 'price', retirado: 'removed' };
const changesCache = new Map(); // `${sync}:${type}` -> filas; el historial no cambia nunca

export async function getChanges(uid, syncId, { type, limit = 300 } = {}) {
  const sb = anonClient();
  let q = sb.from('catalog_syncs').select('id, created_at, source, generated_at, summary');
  q = syncId ? q.eq('id', syncId) : q.order('id', { ascending: false }).limit(1);
  const { data, error } = await q;
  if (error) throw sbError(error);
  const sync = data?.[0];
  if (!sync) return { sync: null, counts: {}, items: [] };
  const counts = Object.fromEntries(Object.entries(TYPES).filter(([, k]) => sync.summary[k]).map(([t, k]) => [t, sync.summary[k]]));

  const key = `${sync.id}:${type || ''}`;
  if (!changesCache.has(key)) {
    if (changesCache.size > 50) changesCache.clear();
    changesCache.set(key, await fetchAll(() => {
      const c = sb.from('catalog_changes').select('id, element_id, design_id, color_id, type, old_value, new_value').eq('sync_id', sync.id);
      return (type ? c.eq('type', type) : c).order('id');
    }));
  }
  // Primero las piezas que tienes
  const items = changesCache.get(key)
    .map(c => ({ ...c, design_name: repo.getDesignBasic(c.design_id)?.name || null, qty: repo.getQty(uid, c.design_id, c.color_id) }))
    .sort((a, b) => (b.qty > 0) - (a.qty > 0) || a.type.localeCompare(b.type) || a.id - b.id)
    .slice(0, Math.min(limit, 2000));
  return { sync, counts, items };
}
