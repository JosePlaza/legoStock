// Descarga el catálogo de LEGO Pick a Brick.
// JavaScript sin dependencias: lo usan la API local (Node) y la Edge Function sync-catalog (Deno).
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getPage(base, p) {
  let lastErr;
  for (let t = 0; t < 3; t++) {
    try {
      const res = await fetch(`${base}?page=${p}`, { headers: HEADERS });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
      if (!m) throw new Error('La página no trae datos (__NEXT_DATA__); puede que LEGO esté bloqueando la petición');
      return JSON.parse(m[1]).props.pageProps.__APOLLO_STATE__;
    } catch (e) {
      lastErr = e;
      await sleep(1500 * (t + 1));
    }
  }
  throw lastErr;
}

export async function fetchCatalog({ locale = 'es-es', onProgress = () => {} } = {}) {
  const base = `https://www.lego.com/${locale}/pick-and-build/pick-a-brick`;
  const first = await getPage(base, 1);
  const total = Number((JSON.stringify(first.ROOT_QUERY || {}).match(/"total":(\d+)/) || [])[1] || 0);
  if (!total) throw new Error('No he podido leer el número total de piezas de Pick a Brick');
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
  onProgress(1, pages);
  for (let p = 2; p <= pages; p += 3) {
    const batch = [p, p + 1, p + 2].filter(x => x <= pages);
    const res = await Promise.allSettled(batch.map(p => getPage(base, p)));
    res.forEach((r, i) => (r.status === 'fulfilled' ? handle(r.value) : failed.push(batch[i])));
    onProgress(Math.min(p + 2, pages), pages);
    await sleep(250);
  }
  if (failed.length > pages * 0.1) throw new Error(`Han fallado demasiadas páginas (${failed.length} de ${pages}). Prueba más tarde.`);
  const best = Object.fromEntries(Object.entries(hexCount).map(([h, m]) => [h, Object.entries(m).sort((a, b) => b[1] - a[1])[0][0]]));
  for (const e of Object.values(els)) if (!e[2]) e[2] = best[e[3]] || null;
  return {
    source: `lego.com pick-a-brick ${locale}`,
    generatedAt: new Date().toISOString(),
    failedPages: failed,
    colors, categories: cats, subcategories: subs,
    designs: Object.values(designs),
    elements: Object.values(els).map(e => [e[0], e[1], e[2], e[4], e[5]]),
  };
}
