// ============================================================================
// Actualizar el catálogo de LegoStock desde LEGO Pick a Brick
// 1. Abre https://www.lego.com/es-es/pick-and-build/pick-a-brick en Chrome
// 2. Abre la consola (Cmd+Opt+J), pega este archivo entero y pulsa Enter
// 3. Se descargará "legostock-catalog.json" (tarda ~1 minuto)
// 4. En LegoStock pulsa "↻ Catálogo" y elige ese archivo (tu stock no se toca)
// ============================================================================
(async () => {
  const get = async p => {
    for (let t = 0; t < 3; t++) {
      try {
        const h = await (await fetch(location.pathname + '?page=' + p)).text();
        const m = h.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
        return JSON.parse(m[1]).props.pageProps.__APOLLO_STATE__;
      } catch (e) { await new Promise(r => setTimeout(r, 1500)); }
    }
    return null;
  };
  const first = await get(1);
  const total = Number((JSON.stringify(first.ROOT_QUERY).match(/"total":(\d+)/) || [])[1] || 5000);
  const pages = Math.ceil(total / 50);
  const colors = {}, cats = {}, subs = {}, designs = {}, els = {}, hexCount = {};
  const failed = [];
  const handle = A => {
    for (const [k, v] of Object.entries(A)) {
      if (!k.startsWith('SearchResultElement:')) continue;
      const f = v.facets || {}, c = f.color || {}, cat = f.category || {}, sub = f.subcategory || {};
      const hex = (v.colorHex || '').toLowerCase();
      if (c.key) {
        colors[c.key] = { name: c.name, hex, family: f.colorFamily?.name };
        (hexCount[hex] ||= {})[c.key] = (hexCount[hex][c.key] || 0) + 1;
      }
      if (cat.key) cats[cat.key] = cat.name;
      if (sub.key) subs[sub.key] = { name: sub.name, cat: cat.key };
      designs[v.designId] ||= [v.designId, v.name, cat.key || null, sub.key || null];
      els[v.id] = [v.id, v.designId, c.key || null, hex, Math.round((v.price?.formattedValue || 0) * 100), v.availability === 'AVAILABLE' ? 1 : 0];
      for (const r of v.siblings || []) {
        const s = A[r.__ref];
        if (s && !els[s.id]) els[s.id] = [s.id, v.designId, null, (s.colorHex || '').toLowerCase(), Math.round((s.price?.formattedValue || 0) * 100), s.availability === 'AVAILABLE' ? 1 : 0];
      }
    }
  };
  handle(first);
  for (let p = 2; p <= pages; p += 4) {
    const batch = await Promise.all([p, p + 1, p + 2, p + 3].filter(x => x <= pages).map(async x => [x, await get(x)]));
    for (const [x, A] of batch) A ? handle(A) : failed.push(x);
    console.log(`LegoStock: página ${Math.min(p + 3, pages)}/${pages}`);
  }
  // Los "siblings" solo traen el color en hex: lo traducimos al color LEGO más habitual con ese hex.
  const best = Object.fromEntries(Object.entries(hexCount).map(([h, m]) => [h, Object.entries(m).sort((a, b) => b[1] - a[1])[0][0]]));
  for (const e of Object.values(els)) if (!e[2]) e[2] = best[e[3]] || null;
  const out = {
    source: 'lego.com pick-a-brick ' + location.pathname.split('/')[1],
    generatedAt: new Date().toISOString(),
    colors, categories: cats, subcategories: subs,
    designs: Object.values(designs),
    elements: Object.values(els).map(e => [e[0], e[1], e[2], e[4], e[5]]),
  };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(out)], { type: 'application/json' }));
  a.download = 'legostock-catalog.json';
  a.click();
  console.log(`LegoStock: ${out.designs.length} piezas, ${out.elements.length} variantes. Páginas fallidas: ${failed.join(', ') || 'ninguna'}`);
})();
