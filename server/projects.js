// Proyectos (listas de Rebrickable) y sus archivos, guardados en Supabase (tablas + Storage).
import { compare, readCsv, resolveForStock, unresolvedParts } from './rebrickable.js';
import { resolveParts } from './rebrickable-api.js';
import { check } from './supabase.js';
import { refreshStock, effectiveColorMap, adjustBulk } from './userdata.js';

export const BUCKET = 'project-files';
const FIELDS = '*';

// Detecta un número de set en el nombre del archivo: "rebrickable_parts_10294-1.csv" -> "10294-1"
export const guessSetNum = name => (String(name || '').match(/(\d{3,7}-\d{1,2})/) || [])[1] || null;
const storageKey = n => String(n || 'archivo').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.\-]+/g, '_').slice(0, 100);
const displayName = n => String(n || 'archivo').replace(/[\\/]/g, '_').slice(0, 160);
const nowIso = () => new Date().toISOString();

export async function ctx(req, csvs = []) {
  await refreshStock(req);
  const [colorMap, partMap] = await Promise.all([effectiveColorMap(req), resolveParts(unresolvedParts(csvs, { spares: true }))]);
  return { uid: req.user.id, colorMap, partMap };
}

async function signUrls(req, paths) {
  const list = [...new Set(paths.filter(Boolean))];
  if (!list.length) return {};
  const data = check(await req.sb.storage.from(BUCKET).createSignedUrls(list, 3600));
  return Object.fromEntries(data.filter(d => d.signedUrl).map(d => [d.path, d.signedUrl]));
}

const publicProject = p => { const { csv, ...rest } = p; return rest; };

export async function list(req) {
  const projects = check(await req.sb.from('projects').select(FIELDS + ', project_files(count)').eq('user_id', req.user.id).order('updated_at', { ascending: false }));
  const c = await ctx(req, projects.map(p => p.csv));
  const coverIds = projects.map(p => p.cover_file_id).filter(Boolean);
  const covers = coverIds.length ? check(await req.sb.from('project_files').select('id, storage_path').in('id', coverIds)) : [];
  const urls = await signUrls(req, covers.map(f => f.storage_path));
  const coverUrl = Object.fromEntries(covers.map(f => [f.id, urls[f.storage_path]]));
  return projects.map(p => {
    let summary;
    try { summary = compare(p.csv, { spares: p.include_spares, noAlt: p.no_alt || [] }, c).summary; } catch (e) { summary = { error: e.message }; }
    const { project_files, ...rest } = publicProject(p);
    return { ...rest, files: project_files?.[0]?.count || 0, cover_url: coverUrl[p.cover_file_id] || null, summary };
  });
}

async function getRow(req, id) {
  const rows = check(await req.sb.from('projects').select(FIELDS).eq('id', Number(id)).limit(1));
  return rows[0] || null;
}

export async function files(req, id) {
  const rows = check(await req.sb.from('project_files').select('*').eq('project_id', Number(id)).order('id'));
  const urls = await signUrls(req, rows.map(f => f.storage_path));
  return rows.map(f => ({ ...f, url: urls[f.storage_path] || null }));
}

export async function detail(req, id) {
  const p = await getRow(req, id);
  if (!p) return null;
  const c = await ctx(req, [p.csv]);
  let result = null, error = null;
  try { result = compare(p.csv, { spares: p.include_spares, noAlt: p.no_alt || [] }, c); } catch (e) { error = e.message; }
  const fl = await files(req, id);
  return { project: { ...publicProject(p), cover_url: fl.find(f => f.id === p.cover_file_id)?.url || null }, result, error, files: fl };
}

export async function create(req, { csv, name, filename, include_spares }) {
  readCsv(csv); // valida antes de guardar
  const base = String(filename || '').replace(/\.(csv|txt)$/i, '');
  const rows = check(await req.sb.from('projects').insert({
    user_id: req.user.id,
    name: (name || base || 'Proyecto sin nombre').trim(),
    filename: filename || null,
    set_num: guessSetNum(filename),
    csv,
    include_spares: !!include_spares,
  }).select(FIELDS));
  return publicProject(rows[0]);
}

const EDITABLE = ['name', 'set_num', 'notes', 'include_spares', 'csv', 'filename', 'cover_file_id', 'no_alt', 'links'];
export async function update(req, id, fields) {
  const patch = {};
  for (const k of EDITABLE) if (fields[k] !== undefined) patch[k] = fields[k];
  if (patch.csv !== undefined) readCsv(patch.csv);
  if (patch.set_num === '') patch.set_num = null;
  if (patch.links !== undefined) {
    if (!Array.isArray(patch.links)) throw new Error('Enlaces no válidos');
    patch.links = patch.links.slice(0, 100).map(l => {
      let url = String(l?.url || '').trim();
      if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url;
      try { url = new URL(url).toString(); } catch { throw new Error(`Enlace no válido: ${l?.url}`); }
      return { url, title: String(l?.title || '').trim().slice(0, 200) || new URL(url).hostname.replace(/^www\./, ''), added_at: l?.added_at || new Date().toISOString() };
    });
  }
  if (patch.no_alt !== undefined) patch.no_alt = [...new Set((Array.isArray(patch.no_alt) ? patch.no_alt : []).map(String))].slice(0, 5000);
  if (patch.include_spares !== undefined) patch.include_spares = !!patch.include_spares;
  if (patch.cover_file_id) {
    const f = check(await req.sb.from('project_files').select('id, mime').eq('project_id', Number(id)).eq('id', Number(patch.cover_file_id)).limit(1))[0];
    if (!f || !String(f.mime).startsWith('image/')) throw new Error('La portada tiene que ser una imagen del proyecto');
  }
  patch.updated_at = nowIso();
  const rows = check(await req.sb.from('projects').update(patch).eq('id', Number(id)).select(FIELDS));
  if (!rows[0]) throw new Error('Proyecto no encontrado');
  return publicProject(rows[0]);
}

export async function remove(req, id) {
  const fl = check(await req.sb.from('project_files').select('storage_path').eq('project_id', Number(id)));
  if (fl.length) check(await req.sb.storage.from(BUCKET).remove(fl.map(f => f.storage_path)));
  check(await req.sb.from('projects').delete().eq('id', Number(id)));
}

export async function addAllToStock(req, id) {
  const p = await getRow(req, id);
  if (!p) throw new Error('Proyecto no encontrado');
  const c = await ctx(req, [p.csv]);
  const { items, skipped } = resolveForStock(p.csv, { spares: p.include_spares }, c.colorMap, c.partMap);
  await adjustBulk(req, items, 'rebrickable');
  return { added: items.reduce((s, i) => s + i.delta, 0), lots: items.length, skipped };
}

// ----- Archivos -----
export async function saveFile(req, pid, { filename, mime, buffer, cover, storedName, createdAt }) {
  if (cover && !String(mime).startsWith('image/')) throw new Error('La portada tiene que ser una imagen (JPG, PNG, WEBP…)');
  if (!buffer?.length) throw new Error('Archivo vacío');
  if (!(await getRow(req, pid))) throw new Error('Proyecto no encontrado');
  const path = `${req.user.id}/${Number(pid)}/${storedName ? storageKey(storedName) : `${Date.now()}-${storageKey(filename)}`}`;
  check(await req.sb.storage.from(BUCKET).upload(path, buffer, { contentType: mime || 'application/octet-stream', upsert: false }));
  const row = check(await req.sb.from('project_files').insert({
    user_id: req.user.id, project_id: Number(pid), filename: displayName(filename), storage_path: path,
    mime: mime || 'application/octet-stream', size: buffer.length, ...(createdAt ? { created_at: createdAt } : {}),
  }).select('*'))[0];
  const touch = { updated_at: nowIso() };
  if (cover) touch.cover_file_id = row.id;
  check(await req.sb.from('projects').update(touch).eq('id', Number(pid)));
  const urls = await signUrls(req, [path]);
  return { ...row, url: urls[path] || null };
}

// Archivo que el navegador ya ha subido a Storage (en su carpeta <usuario>/<proyecto>/): solo falta apuntarlo.
export async function registerFile(req, pid, { path, filename, mime, size, cover }) {
  const prefix = `${req.user.id}/${Number(pid)}/`;
  if (typeof path !== 'string' || !path.startsWith(prefix) || path.includes('..')) throw new Error('Ruta de archivo no válida');
  const discard = async msg => { await req.sb.storage.from(BUCKET).remove([path]); throw new Error(msg); };
  if (cover && !String(mime).startsWith('image/')) await discard('La portada tiene que ser una imagen (JPG, PNG, WEBP…)');
  if (!(await getRow(req, pid))) await discard('Proyecto no encontrado');
  const row = check(await req.sb.from('project_files').insert({
    user_id: req.user.id, project_id: Number(pid), filename: displayName(filename), storage_path: path,
    mime: mime || 'application/octet-stream', size: Math.max(0, Number(size) || 0),
  }).select('*'))[0];
  const touch = { updated_at: nowIso() };
  if (cover) touch.cover_file_id = row.id;
  check(await req.sb.from('projects').update(touch).eq('id', Number(pid)));
  const urls = await signUrls(req, [path]);
  return { ...row, url: urls[path] || null };
}

export async function deleteFile(req, pid, fid) {
  const f = check(await req.sb.from('project_files').select('*').eq('project_id', Number(pid)).eq('id', Number(fid)).limit(1))[0];
  if (!f) return;
  check(await req.sb.storage.from(BUCKET).remove([f.storage_path]));
  check(await req.sb.from('project_files').delete().eq('id', f.id));
  check(await req.sb.from('projects').update({ cover_file_id: null }).eq('id', Number(pid)).eq('cover_file_id', f.id));
}
