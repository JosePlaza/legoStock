// Qué ha cambiado entre dos catálogos de Pick a Brick (el guardado y el nuevo).
// JavaScript sin dependencias: lo usa la Edge Function sync-catalog para guardar el historial en Supabase.

export function checkCatalog(cat) {
  if (!cat || !Array.isArray(cat.designs) || !Array.isArray(cat.elements) || !cat.colors) {
    throw new Error('El archivo no parece un catálogo de LegoStock (faltan designs / elements / colors)');
  }
}

// Elementos: [element_id, design_id, color_id, price_cents, available]
export function diffCatalogs(prev, next) {
  const old = new Map((prev?.elements || []).map(e => [String(e[0]), e]));
  const firstImport = old.size === 0;
  const c = { new: 0, soldout: 0, restocked: 0, price: 0, removed: 0 };
  const changes = [];
  const add = (type, e, oldValue, newValue) => changes.push({
    element_id: String(e[0]), design_id: String(e[1]), color_id: e[2] ? String(e[2]) : '0', type, old_value: oldValue, new_value: newValue,
  });

  if (!firstImport) {
    const seen = new Set();
    for (const e of next.elements) {
      const id = String(e[0]), price = e[3] ?? null, av = e[4] ?? 1;
      seen.add(id);
      const o = old.get(id);
      if (!o) { c.new++; add('nuevo', e, null, price); continue; }
      const oldAv = o[4] ?? 1;
      if (oldAv && !av) { c.soldout++; add('agotado', e, 1, 0); }
      else if (!oldAv && av) { c.restocked++; add('repuesto', e, 0, 1); }
      if (o[3] != null && price != null && o[3] !== price) { c.price++; add('precio', e, o[3], price); }
    }
    // Si la descarga vino muy incompleta no damos nada por retirado.
    if (seen.size >= old.size * 0.6) {
      for (const [id, o] of old) if (!seen.has(id)) { c.removed++; add('retirado', o, null, null); }
    }
  }
  const summary = { designs: next.designs.length, elements: next.elements.length, colors: Object.keys(next.colors).length, firstImport, ...c };
  return { summary, changes };
}
