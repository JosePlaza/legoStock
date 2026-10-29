// Base local SQLite (better-sqlite3).
// - Catálogo de LEGO (público, se regenera desde Pick a Brick).
// - stock_cache: copia temporal del stock de cada usuario traída de Supabase, para poder filtrar/ordenar con SQL.
// - Tablas "legacy" (stock, movements, projects…): los datos de antes de Supabase. NO se borran nunca;
//   sirven de origen para la importación a la cuenta (server/migrate.js).
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = path.join(ROOT, 'data');
// En Vercel solo se puede escribir en /tmp, y se pierde al apagarse la función: la base es una caché
// que se rellena con el catálogo (de Supabase o de data/catalog.json) y el stock de cada usuario.
export const SERVERLESS = !!process.env.VERCEL;
const DB_PATH = process.env.LEGOSTOCK_DB || (SERVERLESS ? '/tmp/legostock.db' : path.join(DATA_DIR, 'legostock.db'));
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

// Copia del último catálogo en data/catalog.json (en Vercel se lee la que va en el despliegue y no se escribe).
export const CATALOG_FILE = path.join(DATA_DIR, 'catalog.json');
export function saveCatalogFile(cat) {
  if (!SERVERLESS) fs.writeFileSync(CATALOG_FILE, JSON.stringify(cat));
}

export const db = new Database(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS colors (id TEXT PRIMARY KEY, name TEXT NOT NULL, hex TEXT, family TEXT);
  CREATE TABLE IF NOT EXISTS categories (id TEXT PRIMARY KEY, name TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS subcategories (id TEXT PRIMARY KEY, name TEXT NOT NULL, category_id TEXT);
  CREATE TABLE IF NOT EXISTS designs (
    design_id TEXT PRIMARY KEY, name TEXT NOT NULL, category_id TEXT, subcategory_id TEXT, sort INTEGER
  );
  CREATE TABLE IF NOT EXISTS elements (
    element_id TEXT PRIMARY KEY, design_id TEXT NOT NULL, color_id TEXT NOT NULL,
    price_cents INTEGER, available INTEGER DEFAULT 1
  );
  CREATE INDEX IF NOT EXISTS idx_elements_design ON elements(design_id);
  CREATE INDEX IF NOT EXISTS idx_elements_color ON elements(color_id);
  CREATE TABLE IF NOT EXISTS stock (
    design_id TEXT NOT NULL, color_id TEXT NOT NULL, qty INTEGER NOT NULL DEFAULT 0, updated_at TEXT,
    PRIMARY KEY (design_id, color_id)
  );
  CREATE TABLE IF NOT EXISTS movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT, design_id TEXT, color_id TEXT, delta INTEGER,
    source TEXT, created_at TEXT
  );
  CREATE TABLE IF NOT EXISTS rb_color_map (rb_color TEXT PRIMARY KEY, lego_color_id TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, filename TEXT, set_num TEXT,
    csv TEXT NOT NULL, include_spares INTEGER DEFAULT 0, notes TEXT, created_at TEXT, updated_at TEXT
  );
  CREATE TABLE IF NOT EXISTS stock_cache (
    user_id TEXT NOT NULL, design_id TEXT NOT NULL, color_id TEXT NOT NULL, qty INTEGER NOT NULL,
    PRIMARY KEY (user_id, design_id, color_id)
  );
  CREATE TABLE IF NOT EXISTS project_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, filename TEXT, stored_name TEXT,
    mime TEXT, size INTEGER, created_at TEXT
  );
`);

// Migraciones de columnas añadidas después de la v0.1
const cols = t => db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name);
if (!cols('elements').includes('removed')) db.exec('ALTER TABLE elements ADD COLUMN removed INTEGER DEFAULT 0');
if (!cols('elements').includes('last_seen_at')) db.exec('ALTER TABLE elements ADD COLUMN last_seen_at TEXT');
if (!cols('projects').includes('cover_file_id')) db.exec('ALTER TABLE projects ADD COLUMN cover_file_id INTEGER');

const now = () => new Date().toISOString();

function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}
export const withTransaction = tx;

// ---------- Catálogo ----------
export function isCatalogEmpty() {
  return db.prepare('SELECT COUNT(*) AS n FROM designs').get().n === 0;
}

// Inserta o actualiza el catálogo y cuenta qué ha cambiado respecto a la versión anterior.
// No borra nada: las variantes que ya no aparecen en LEGO se marcan como "retiradas".
// El historial detallado de cambios lo guarda Supabase (supabase/functions/sync-catalog/catalog-diff.js).
export function upsertCatalog(cat) {
  if (!cat || !Array.isArray(cat.designs) || !Array.isArray(cat.elements) || !cat.colors) {
    throw new Error('El archivo no parece un catálogo de LegoStock (faltan designs / elements / colors)');
  }
  return tx(() => {
    const t = now();
    const insColor = db.prepare('INSERT OR REPLACE INTO colors (id, name, hex, family) VALUES (?, ?, ?, ?)');
    insColor.run('0', 'Desconocido', '#cccccc', 'Otros');
    for (const [id, c] of Object.entries(cat.colors)) insColor.run(String(id), c.name, c.hex || null, c.family || null);
    const insCat = db.prepare('INSERT OR REPLACE INTO categories (id, name) VALUES (?, ?)');
    for (const [id, name] of Object.entries(cat.categories || {})) insCat.run(String(id), name);
    const insSub = db.prepare('INSERT OR REPLACE INTO subcategories (id, name, category_id) VALUES (?, ?, ?)');
    for (const [id, s] of Object.entries(cat.subcategories || {})) insSub.run(String(id), s.name, s.cat ? String(s.cat) : null);

    db.exec('UPDATE designs SET sort = 1000000 + COALESCE(sort, 0) WHERE COALESCE(sort, 0) < 1000000');
    const upDesign = db.prepare(`INSERT INTO designs (design_id, name, category_id, subcategory_id, sort) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (design_id) DO UPDATE SET name = excluded.name, category_id = excluded.category_id,
        subcategory_id = excluded.subcategory_id, sort = excluded.sort`);
    cat.designs.forEach((d, i) => upDesign.run(String(d[0]), d[1] || '', d[2] ?? null, d[3] ?? null, i));

    const existing = new Map(db.prepare('SELECT element_id, design_id, color_id, price_cents, available, removed FROM elements').all().map(r => [r.element_id, r]));
    const firstImport = existing.size === 0;
    const upEl = db.prepare(`INSERT INTO elements (element_id, design_id, color_id, price_cents, available, removed, last_seen_at)
      VALUES (?, ?, ?, ?, ?, 0, ?)
      ON CONFLICT (element_id) DO UPDATE SET design_id = excluded.design_id, color_id = excluded.color_id,
        price_cents = excluded.price_cents, available = excluded.available, removed = 0, last_seen_at = excluded.last_seen_at`);

    const c = { new: 0, soldout: 0, restocked: 0, price: 0, removed: 0 };
    const seen = new Set();
    for (const e of cat.elements) {
      const id = String(e[0]), design = String(e[1]), color = e[2] ? String(e[2]) : '0';
      const price = e[3] ?? null, av = e[4] ?? 1;
      const old = existing.get(id);
      seen.add(id);
      if (!firstImport) {
        if (!old || old.removed) c.new++;
        else {
          if (old.available && !av) c.soldout++;
          else if (!old.available && av) c.restocked++;
          if (old.price_cents != null && price != null && old.price_cents !== price) c.price++;
        }
      }
      upEl.run(id, design, color, price, av, t);
    }
    // Si la descarga vino muy incompleta no marcamos nada como retirado.
    if (!firstImport && seen.size >= existing.size * 0.6) {
      const markRemoved = db.prepare('UPDATE elements SET removed = 1, available = 0 WHERE element_id = ?');
      for (const [id, old] of existing) {
        if (!seen.has(id) && !old.removed) { markRemoved.run(id); c.removed++; }
      }
    }
    const setMeta = db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)');
    setMeta.run('catalog_generated_at', cat.generatedAt || t);
    setMeta.run('catalog_source', cat.source || 'desconocido');
    setMeta.run('catalog_imported_at', t);
    const summary = { designs: cat.designs.length, elements: cat.elements.length, colors: Object.keys(cat.colors).length, firstImport, ...c };
    return summary;
  });
}
export const importCatalog = upsertCatalog;

export function getMeta(uid) {
  const colors = db.prepare(`
    SELECT c.id, c.name, c.hex, c.family,
      (SELECT COUNT(DISTINCT e.design_id) FROM elements e WHERE e.color_id = c.id) AS n
    FROM colors c WHERE EXISTS (SELECT 1 FROM elements e WHERE e.color_id = c.id)
    ORDER BY c.family, c.name`).all();
  const allColors = db.prepare('SELECT id, name, hex, family FROM colors ORDER BY name').all();
  const categories = db.prepare(`
    SELECT c.id, c.name, (SELECT COUNT(*) FROM designs d WHERE d.category_id = c.id) AS n
    FROM categories c ORDER BY c.name`).all();
  const subcategories = db.prepare(`
    SELECT s.id, s.name, s.category_id, (SELECT COUNT(*) FROM designs d WHERE d.subcategory_id = s.id) AS n
    FROM subcategories s ORDER BY s.name`).all();
  const totals = db.prepare(`
    SELECT COALESCE(SUM(s.qty), 0) AS pieces,
           COALESCE(SUM(CASE WHEN s.qty > 0 THEN 1 ELSE 0 END), 0) AS lots,
           COUNT(DISTINCT CASE WHEN s.qty > 0 THEN s.design_id END) AS designs,
           COALESCE(SUM(s.qty * COALESCE((SELECT MIN(e.price_cents) FROM elements e
             WHERE e.design_id = s.design_id AND e.color_id = s.color_id), 0)), 0) AS value_cents
    FROM stock_cache s WHERE s.user_id = ?`).get(String(uid));
  const m = Object.fromEntries(db.prepare('SELECT key, value FROM meta').all().map(r => [r.key, r.value]));
  const counts = db.prepare(`SELECT (SELECT COUNT(*) FROM designs) AS designs,
    (SELECT COUNT(*) FROM elements WHERE removed = 0) AS elements,
    (SELECT COUNT(*) FROM elements WHERE removed = 0 AND available = 1) AS available,
    (SELECT COUNT(*) FROM elements WHERE removed = 0 AND available = 0) AS soldout,
    (SELECT COUNT(*) FROM elements WHERE removed = 1) AS removed`).get();
  return {
    colors, allColors, categories, subcategories, totals,
    catalog: {
      ...counts, generatedAt: m.catalog_generated_at || null, importedAt: m.catalog_imported_at || null, source: m.catalog_source || null,
      lastSync: m.catalog_sync_attempted_at ? {
        attemptedAt: m.catalog_sync_attempted_at, status: m.catalog_sync_status || null,
        error: m.catalog_sync_error || null, trigger: m.catalog_sync_trigger || null,
      } : null,
    },
  };
}

// ---------- Piezas ----------
const VARIANTS_SQL = `(SELECT json_group_array(json_object(
    'element_id', e.element_id, 'color_id', e.color_id, 'price_cents', e.price_cents,
    'available', e.available, 'removed', e.removed, 'qty', COALESCE(s.qty, 0)))
  FROM elements e LEFT JOIN stock_cache s ON s.user_id = @uid AND s.design_id = e.design_id AND s.color_id = e.color_id
  WHERE e.design_id = d.design_id)`;

const DESIGN_SELECT = `SELECT d.design_id, d.name, d.category_id, d.subcategory_id,
  (SELECT COALESCE(SUM(qty), 0) FROM stock_cache s WHERE s.user_id = @uid AND s.design_id = d.design_id) AS total_qty,
  (SELECT MIN(price_cents) FROM elements e WHERE e.design_id = d.design_id AND e.removed = 0) AS min_price,
  ${VARIANTS_SQL} AS variants
  FROM designs d`;

function mapDesign(row) {
  if (!row) return null;
  const seen = new Set();
  const variants = JSON.parse(row.variants || '[]')
    .sort((a, b) => (a.removed - b.removed) || (b.available - a.available) || (a.price_cents - b.price_cents))
    .filter(v => (seen.has(v.color_id) ? false : seen.add(v.color_id)));
  return { ...row, variants };
}

const SORTS = {
  relevance: 'd.sort',
  name: 'd.name COLLATE NOCASE, d.sort',
  price: 'min_price, d.sort',
  price_desc: 'min_price DESC, d.sort',
  qty: 'total_qty DESC, d.sort',
};

export function listDesigns(uid, { q, cat, sub, color, owned, avail, sort = 'relevance', limit = 48, offset = 0 } = {}) {
  const where = [];
  const p = { uid: String(uid) };
  let n = 0;
  const bind = v => { const k = `p${n++}`; p[k] = v; return '@' + k; };
  if (q && q.trim()) {
    const t = q.trim();
    if (/^\d+$/.test(t)) {
      const x = bind(t), like = bind(`%${t}%`);
      where.push(`(d.design_id = ${x} OR EXISTS (SELECT 1 FROM elements e WHERE e.design_id = d.design_id AND e.element_id = ${x}) OR d.name LIKE ${like})`);
    } else {
      for (const word of t.split(/\s+/)) where.push(`d.name LIKE ${bind(`%${word}%`)}`);
    }
  }
  if (cat) where.push(`d.category_id = ${bind(String(cat))}`);
  if (sub) where.push(`d.subcategory_id = ${bind(String(sub))}`);
  const colorCond = color ? ` AND e.color_id = ${bind(String(color))}` : '';
  if (color) where.push(`EXISTS (SELECT 1 FROM elements e WHERE e.design_id = d.design_id${colorCond})`);
  if (avail === 'available') where.push(`EXISTS (SELECT 1 FROM elements e WHERE e.design_id = d.design_id AND e.available = 1 AND e.removed = 0${colorCond})`);
  else if (avail === 'soldout') where.push(`NOT EXISTS (SELECT 1 FROM elements e WHERE e.design_id = d.design_id AND e.available = 1 AND e.removed = 0${colorCond})`);
  if (owned) where.push('EXISTS (SELECT 1 FROM stock_cache s WHERE s.user_id = @uid AND s.design_id = d.design_id AND s.qty > 0)');
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) AS n FROM designs d ${w}`).get(p).n;
  p.lim = Math.min(Math.max(parseInt(limit, 10) || 48, 1), 200);
  p.off = Math.max(parseInt(offset, 10) || 0, 0);
  const rows = db.prepare(`${DESIGN_SELECT} ${w} ORDER BY ${SORTS[sort] || SORTS.relevance} LIMIT @lim OFFSET @off`).all(p);
  return { total, items: rows.map(mapDesign) };
}

export function getDesign(uid, designId) {
  return mapDesign(db.prepare(`${DESIGN_SELECT} WHERE d.design_id = @id`).get({ uid: String(uid), id: String(designId) }));
}

export const designExists = id => !!db.prepare('SELECT 1 AS x FROM designs WHERE design_id = ?').get(String(id));
export const getDesignBasic = id => db.prepare('SELECT design_id, name FROM designs WHERE design_id = ?').get(String(id)) || null;
export const getElement = id => db.prepare('SELECT * FROM elements WHERE element_id = ?').get(String(id)) || null;
export const elementFor = (designId, colorId) => db.prepare(
  'SELECT * FROM elements WHERE design_id = ? AND color_id = ? ORDER BY removed, available DESC, price_cents LIMIT 1'
).get(String(designId), String(colorId)) || null;
export const anyElement = designId => db.prepare(
  'SELECT * FROM elements WHERE design_id = ? ORDER BY removed, available DESC, price_cents LIMIT 1'
).get(String(designId)) || null;
export const getColor = id => db.prepare('SELECT * FROM colors WHERE id = ?').get(String(id)) || null;
export const colorByName = name => db.prepare('SELECT * FROM colors WHERE name = ? COLLATE NOCASE').get(String(name)) || null;

// ---------- Caché del stock del usuario (el original está en Supabase) ----------
export function replaceStockCache(uid, rows) {
  tx(() => {
    db.prepare('DELETE FROM stock_cache WHERE user_id = ?').run(String(uid));
    const ins = db.prepare('INSERT OR REPLACE INTO stock_cache (user_id, design_id, color_id, qty) VALUES (?, ?, ?, ?)');
    for (const r of rows) if (r.qty > 0) ins.run(String(uid), String(r.design_id), String(r.color_id), r.qty);
  });
}
export function setStockCache(uid, designId, colorId, qty) {
  if (qty > 0) db.prepare('INSERT OR REPLACE INTO stock_cache (user_id, design_id, color_id, qty) VALUES (?, ?, ?, ?)').run(String(uid), String(designId), String(colorId), qty);
  else db.prepare('DELETE FROM stock_cache WHERE user_id = ? AND design_id = ? AND color_id = ?').run(String(uid), String(designId), String(colorId));
}
export const getQty = (uid, designId, colorId) =>
  db.prepare('SELECT qty FROM stock_cache WHERE user_id = ? AND design_id = ? AND color_id = ?').get(String(uid), String(designId), String(colorId))?.qty ?? 0;
export const getDesignStock = (uid, designId) =>
  db.prepare('SELECT color_id, qty FROM stock_cache WHERE user_id = ? AND design_id = ? AND qty > 0').all(String(uid), String(designId));
export const getDesignQty = (uid, designId) =>
  db.prepare('SELECT COALESCE(SUM(qty), 0) AS n FROM stock_cache WHERE user_id = ? AND design_id = ?').get(String(uid), String(designId)).n;

// ---------- Datos locales anteriores a Supabase (solo lectura) ----------
export function legacySummary() {
  const st = db.prepare('SELECT COUNT(*) AS lots, COALESCE(SUM(qty), 0) AS pieces FROM stock WHERE qty > 0').get();
  return {
    ...st,
    movements: db.prepare('SELECT COUNT(*) AS n FROM movements').get().n,
    projects: db.prepare('SELECT COUNT(*) AS n FROM projects').get().n,
    files: db.prepare('SELECT COUNT(*) AS n FROM project_files').get().n,
    colorMap: db.prepare('SELECT COUNT(*) AS n FROM rb_color_map').get().n,
  };
}
export const legacyStock = () => db.prepare('SELECT design_id, color_id, qty, updated_at FROM stock WHERE qty > 0').all();
export const legacyMovements = () => db.prepare('SELECT design_id, color_id, delta, source, created_at FROM movements ORDER BY id').all();
export const legacyColorMap = () => db.prepare('SELECT rb_color, lego_color_id FROM rb_color_map').all();
export const legacyProjects = () => db.prepare('SELECT * FROM projects ORDER BY id').all();
export const legacyFiles = pid => db.prepare('SELECT * FROM project_files WHERE project_id = ? ORDER BY id').all(Number(pid));
export const getMetaValue = key => db.prepare('SELECT value FROM meta WHERE key = ?').get(key)?.value ?? null;
export const setMetaValue = (key, value) => db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(key, String(value));
