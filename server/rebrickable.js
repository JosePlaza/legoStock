// Lectura de CSV exportados de Rebrickable y comparación con el stock.
// Formatos aceptados (cabeceras flexibles, coma, punto y coma o tabulador):
//   - Export de lista de piezas / set:   Part,Color,Quantity[,Is Spare]
//   - inventory_parts.csv de descargas:  inventory_id,part_num,color_id,quantity,is_spare,img_url
//   - Cualquier CSV con columna de elemento LEGO (Element ID) -> coincidencia exacta.
import * as repo from './db.js';
import { DEFAULT_RB_TO_LEGO } from './rebrickable-colors.js';

export function parseCsv(text) {
  text = String(text || '').replace(/^﻿/, '');
  const first = text.split(/\r?\n/, 1)[0] || '';
  const count = ch => first.split(ch).length;
  const delim = count('\t') > count(',') && count('\t') > count(';') ? '\t' : count(';') > count(',') ? ';' : ',';
  const rows = [];
  let row = [], cur = '', q = false;
  const pushRow = () => { row.push(cur); cur = ''; if (row.some(c => c.trim() !== '')) rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; pushRow(); }
    else cur += ch;
  }
  pushRow();
  return rows;
}

const norm = s => String(s).toLowerCase().replace(/[^a-z]/g, '');
const COLS = {
  part: ['part', 'partnum', 'partno', 'partnumber', 'designid', 'itemid', 'itemno'],
  color: ['color', 'colorid', 'colour', 'colourid'],
  qty: ['quantity', 'qty', 'count', 'minqty'],
  spare: ['isspare', 'spare'],
  element: ['element', 'elementid'],
  img: ['imgurl', 'image', 'imageurl'],
};

export function readCsv(text, { spares = false } = {}) {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error('El CSV está vacío o solo tiene cabecera');
  const head = rows[0].map(norm);
  const idx = {};
  for (const [k, names] of Object.entries(COLS)) idx[k] = head.findIndex(h => names.includes(h));
  if (idx.part < 0 || idx.color < 0) {
    throw new Error(`No encuentro las columnas de pieza y color. Cabeceras leídas: ${rows[0].join(', ')}`);
  }
  const agg = new Map();
  let skippedSpares = 0;
  for (const r of rows.slice(1)) {
    const part = (r[idx.part] || '').trim();
    if (!part) continue;
    const color = (r[idx.color] || '').trim();
    const qty = idx.qty >= 0 ? parseInt(r[idx.qty], 10) || 0 : 1;
    const isSpare = idx.spare >= 0 && /^(t|true|1|y|yes|si|sí)$/i.test((r[idx.spare] || '').trim());
    if (isSpare && !spares) { skippedSpares += qty; continue; }
    const key = `${part}|${color}`;
    const cur = agg.get(key) || {
      part, color, need: 0,
      element: idx.element >= 0 ? (r[idx.element] || '').trim() : '',
      img: idx.img >= 0 ? (r[idx.img] || '').trim() : '',
    };
    cur.need += qty;
    agg.set(key, cur);
  }
  return { lines: [...agg.values()], skippedSpares };
}

function resolveColor(rbColor, overrides) {
  if (!rbColor) return null;
  if (overrides[rbColor]) return overrides[rbColor];
  if (/^\d+$/.test(rbColor)) return DEFAULT_RB_TO_LEGO[rbColor] ?? null;
  return repo.colorByName(rbColor)?.id ?? null; // CSV con nombres de color LEGO
}

function localDesign(part) {
  // Rebrickable usa a veces sufijos de variante (3069b, 3794a…) que en LEGO no existen.
  const cands = [part, part.replace(/[a-z]+$/i, ''), part.split(/[-.]/)[0]];
  for (const c of cands) if (c && repo.designExists(c)) return c;
  return null;
}

// partMap (de la API de Rebrickable): nº de pieza Rebrickable -> { lego: [design ids], name, img }
// Sirve cuando Rebrickable y LEGO numeran distinto la misma pieza (p. ej. RB 3941 = LEGO 6143).
function resolveDesign(part, partMap = {}) {
  const local = localDesign(part);
  if (local) return local;
  for (const id of partMap[part]?.lego || []) { const d = localDesign(String(id)); if (d) return d; }
  return null;
}

// Piezas de uno o varios CSV que no se encuentran en el catálogo local (para preguntarlas a Rebrickable)
export function unresolvedParts(texts, opts = {}) {
  const out = new Set();
  for (const t of texts) {
    if (!t) continue;
    let lines = [];
    try { lines = readCsv(t, opts).lines; } catch { continue; }
    for (const l of lines) {
      if (l.element && /^\d+$/.test(l.element) && repo.getElement(l.element)) continue;
      if (!localDesign(l.part)) out.add(l.part);
    }
  }
  return [...out];
}

function resolveLine(l, overrides, partMap) {
  let design_id = null, color_id = null;
  if (l.element && /^\d+$/.test(l.element)) {
    const e = repo.getElement(l.element);
    if (e) { design_id = e.design_id; color_id = e.color_id; }
  }
  if (!design_id) design_id = resolveDesign(l.part, partMap);
  if (!color_id) color_id = resolveColor(l.color, overrides);
  return { design_id, color_id };
}

const ORDER = { falta: 0, parcial: 1, color_sin_mapear: 2, no_catalogo: 3, tengo: 4 };

// ctx = { uid, colorMap }: usuario actual (su stock está en stock_cache) y sus colores asignados a mano
export function compare(text, opts = {}, ctx = {}) {
  const { lines, skippedSpares } = readCsv(text, opts);
  const overrides = ctx.colorMap || {};
  const uid = ctx.uid;
  const unmapped = new Set();

  // Stock disponible por pieza y color. Se va "gastando" a medida que se asigna a las líneas,
  // para que dos líneas no cuenten las mismas unidades.
  const pool = new Map();
  const stockOf = d => {
    if (!pool.has(d)) pool.set(d, new Map(repo.getDesignStock(uid, d).map(r => [r.color_id, r.qty])));
    return pool.get(d);
  };
  const colorInfo = id => { const c = repo.getColor(id); return { color_id: id, color_name: c?.name || `LEGO #${id}`, color_hex: c?.hex || null, color_family: c?.family || null }; };

  // 1ª pasada: misma pieza y mismo color
  const rows = lines.map(l => {
    const { design_id, color_id } = resolveLine(l, overrides, ctx.partMap);
    const design = design_id ? repo.getDesignBasic(design_id) : null;
    let have = 0;
    if (design_id && color_id) {
      const st = stockOf(design_id);
      have = Math.min(l.need, st.get(color_id) || 0);
      st.set(color_id, (st.get(color_id) || 0) - have);
    }
    const have_any = design_id ? repo.getDesignQty(uid, design_id) : 0;
    const exact = design_id && color_id ? repo.elementFor(design_id, color_id) : null;
    const shown = exact || (design_id ? repo.anyElement(design_id) : null);
    const color = color_id ? repo.getColor(color_id) : null;
    let status;
    if (!design_id) status = 'no_catalogo';
    else if (!color_id) { status = 'color_sin_mapear'; unmapped.add(l.color); }
    else if (have >= l.need) status = 'tengo';
    else if (have > 0) status = 'parcial';
    else status = 'falta';
    return {
      part: l.part, rb_color: l.color, element: l.element || null,
      design_id, design_name: design?.name || ctx.partMap?.[l.part]?.name || null,
      rb_name: ctx.partMap?.[l.part]?.name || null,
      color_id, color_name: color?.name || (color_id ? `LEGO #${color_id}` : null),
      color_hex: color?.hex || null, color_family: color?.family || null,
      need: l.need, have, have_any, missing: Math.max(0, l.need - have),
      alt: 0, alt_colors: [],
      status,
      element_id: shown?.element_id || null, exact_element: !!exact,
      price_cents: exact && !exact.removed ? exact.price_cents : null,
      available: exact ? (exact.removed ? 'retirado' : exact.available ? 'disponible' : 'agotado') : null,
      img_url: l.img || ctx.partMap?.[l.part]?.img || null,
    };
  });

  // 2ª pasada: lo que falta se intenta cubrir con la misma pieza en otro color (lo que sobre en stock),
  // salvo en las líneas en las que has descartado las alternativas (p. ej. piezas visibles)
  const noAlt = new Set(opts.noAlt || []);
  for (const r of rows) r.key = `${r.part}|${r.rb_color}`;
  for (const r of rows) if (noAlt.has(r.key) && r.missing && r.design_id) {
    r.alt_excluded = true;
    r.alt_possible = [...stockOf(r.design_id).entries()].filter(([c, q]) => c !== r.color_id && q > 0).reduce((s, [, q]) => s + q, 0);
  }
  for (const r of [...rows].sort((a, b) => b.missing - a.missing)) {
    if (!r.missing || !r.design_id || r.alt_excluded) continue;
    const st = stockOf(r.design_id);
    let left = r.missing;
    const options = [...st.entries()].filter(([c, q]) => c !== r.color_id && q > 0).sort((a, b) => b[1] - a[1]);
    for (const [c, q] of options) {
      if (!left) break;
      const take = Math.min(left, q);
      st.set(c, q - take);
      left -= take;
      r.alt_colors.push({ ...colorInfo(c), qty: take });
    }
    r.alt = r.missing - left;
  }
  rows.sort((a, b) => ORDER[a.status] - ORDER[b.status] || b.missing - a.missing);

  const need = rows.reduce((s, r) => s + r.need, 0);
  const covered = rows.reduce((s, r) => s + Math.min(r.have, r.need), 0);
  const alt = rows.reduce((s, r) => s + r.alt, 0);
  const pct = x => (need ? Math.round((x / need) * 1000) / 10 : 0);
  const summary = {
    lines: rows.length,
    pieces_needed: need,
    pieces_have: covered,
    pieces_missing: need - covered,
    pct: pct(covered),
    pieces_alt: alt,
    pct_alt: pct(covered + alt),
    pieces_missing_alt: need - covered - alt,
    lines_alt: rows.filter(r => r.alt > 0).length,
    lines_alt_excluded: rows.filter(r => r.alt_excluded).length,
    lines_ok: rows.filter(r => r.status === 'tengo').length,
    lines_partial: rows.filter(r => r.status === 'parcial').length,
    lines_missing: rows.filter(r => r.status === 'falta').length,
    lines_unresolved: rows.filter(r => r.status === 'color_sin_mapear' || r.status === 'no_catalogo').length,
    missing_value_cents: rows.reduce((s, r) => s + (r.price_cents != null ? r.missing * r.price_cents : 0), 0),
    missing_alt_value_cents: rows.reduce((s, r) => s + (r.price_cents != null ? (r.missing - r.alt) * r.price_cents : 0), 0),
    missing_unpriced_lines: rows.filter(r => r.missing > 0 && r.price_cents == null).length,
    missing_soldout_lines: rows.filter(r => r.missing > 0 && (r.available === 'agotado' || r.available === 'retirado')).length,
    skipped_spares: skippedSpares,
    cover_element: [...rows].filter(r => r.element_id).sort((a, b) => b.need - a.need)[0]?.element_id || null,
  };
  return { summary, rows, unmapped: [...unmapped] };
}

// Piezas de la lista que se pueden identificar (pieza + color), para sumarlas al stock.
export function resolveForStock(text, opts = {}, colorMap = {}, partMap = {}) {
  const { lines } = readCsv(text, opts);
  const items = [];
  let skipped = 0;
  for (const l of lines) {
    const { design_id, color_id } = resolveLine(l, colorMap, partMap);
    if (!design_id || !color_id || l.need <= 0) { skipped++; continue; }
    items.push({ design_id, color_id, delta: l.need });
  }
  return { items, skipped };
}
