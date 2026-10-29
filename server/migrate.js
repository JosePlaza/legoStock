// Importa a la cuenta de Supabase los datos guardados antes en la base local (data/legostock.db).
// No borra ni modifica nada local: solo lee. Se puede repetir sin duplicar (cada paso se apunta como hecho).
import fs from 'node:fs';
import path from 'node:path';
import * as repo from './db.js';
import { check } from './supabase.js';
import { fetchAll, refreshStock } from './userdata.js';
import { saveFile, guessSetNum } from './projects.js';

const LOCAL_FILES = path.join(repo.DATA_DIR, 'projects');
const key = (uid, step) => `migration:${uid}:${step}`;

export async function status(req) {
  const uid = req.user.id;
  const local = repo.legacySummary();
  const { count: remote, error } = await req.sb.from('stock').select('design_id', { count: 'exact', head: true }).eq('user_id', uid).gt('qty', 0);
  if (error) check({ error });
  return {
    local,
    hasLocalData: local.lots > 0 || local.projects > 0,
    doneForMe: !!repo.getMetaValue(key(uid, 'done')),
    doneAt: repo.getMetaValue(key(uid, 'done')),
    importedToOther: (() => { const o = repo.getMetaValue('migration:last_user'); return o && o !== uid ? o : null; })(),
    remoteLots: remote ?? null,
  };
}

const chunks = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

export async function run(req) {
  const uid = req.user.id;
  const report = { stock: {}, movements: 0, colorMap: 0, projects: 0, files: 0, warnings: [] };

  // 1) Stock: nunca baja una cantidad que ya esté en la nube (se queda el mayor de los dos valores).
  const local = repo.legacyStock();
  const remote = await fetchAll(() => req.sb.from('stock').select('design_id, color_id, qty').eq('user_id', uid).order('design_id').order('color_id'));
  const remoteMap = new Map(remote.map(r => [`${r.design_id}|${r.color_id}`, r.qty]));
  const toUpsert = local
    .filter(r => (remoteMap.get(`${r.design_id}|${r.color_id}`) ?? -1) < r.qty)
    .map(r => ({ user_id: uid, design_id: r.design_id, color_id: r.color_id, qty: r.qty, updated_at: r.updated_at || new Date().toISOString() }));
  for (const c of chunks(toUpsert, 500)) check(await req.sb.from('stock').upsert(c, { onConflict: 'user_id,design_id,color_id' }));

  // 2) Historial de movimientos (una sola vez)
  if (!repo.getMetaValue(key(uid, 'movements'))) {
    const mv = repo.legacyMovements().map(m => ({ user_id: uid, design_id: m.design_id, color_id: m.color_id, delta: m.delta, source: m.source || 'local', created_at: m.created_at || new Date().toISOString() }));
    for (const c of chunks(mv, 500)) check(await req.sb.from('movements').insert(c));
    repo.setMetaValue(key(uid, 'movements'), new Date().toISOString());
    report.movements = mv.length;
  }

  // 3) Colores de Rebrickable asignados a mano
  const cm = repo.legacyColorMap().map(r => ({ user_id: uid, rb_color: r.rb_color, lego_color_id: r.lego_color_id }));
  if (cm.length) check(await req.sb.from('rb_color_map').upsert(cm, { onConflict: 'user_id,rb_color' }));
  report.colorMap = cm.length;

  // 4) Proyectos y sus archivos
  for (const p of repo.legacyProjects()) {
    if (repo.getMetaValue(key(uid, `project:${p.id}`))) continue;
    const row = check(await req.sb.from('projects').insert({
      user_id: uid, name: p.name, filename: p.filename, set_num: p.set_num || guessSetNum(p.filename), csv: p.csv,
      include_spares: !!p.include_spares, notes: p.notes || '', created_at: p.created_at, updated_at: p.updated_at,
    }).select('id'))[0];
    let cover = null;
    for (const f of repo.legacyFiles(p.id)) {
      const file = path.join(LOCAL_FILES, String(p.id), f.stored_name);
      if (!fs.existsSync(file)) { report.warnings.push(`No encuentro el archivo «${f.filename}» del proyecto «${p.name}»`); continue; }
      const saved = await saveFile(req, row.id, { filename: f.filename, mime: f.mime, buffer: fs.readFileSync(file), storedName: f.stored_name, createdAt: f.created_at });
      report.files++;
      if (p.cover_file_id === f.id) cover = saved.id;
    }
    check(await req.sb.from('projects').update({ cover_file_id: cover, updated_at: p.updated_at }).eq('id', row.id));
    repo.setMetaValue(key(uid, `project:${p.id}`), String(row.id));
    report.projects++;
  }

  // 5) Comprobación: todo el stock local tiene que estar en la nube con al menos la misma cantidad
  await refreshStock(req, true);
  let ok = 0, missing = 0, pieces = 0;
  for (const r of local) {
    pieces += r.qty;
    if (repo.getQty(uid, r.design_id, r.color_id) >= r.qty) ok++; else missing++;
  }
  report.stock = { lots: local.length, pieces, uploaded: toUpsert.length, verified: ok, failed: missing };
  if (missing) report.warnings.push(`${missing} lotes no se han podido comprobar en la nube. Vuelve a pulsar «Importar»: no se duplica nada.`);
  else {
    repo.setMetaValue(key(uid, 'done'), new Date().toISOString());
    repo.setMetaValue('migration:last_user', uid);
  }
  return report;
}
