// Guarda el catálogo de Pick a Brick en Supabase (catalog_snapshot) con el historial de cambios
// (catalog_syncs / catalog_changes) y el registro de cada intento (catalog_sync_runs).
// - ?trigger=cron|manual: lo descarga de lego.com en segundo plano. La llama pg_cron cada día (supabase/schema.sql).
// - ?trigger=import|local: recibe el catálogo en el cuerpo ({ catalog }) desde la API de LegoStock.
// Se protege con la cabecera x-cron-secret.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { fetchCatalog } from './pick-a-brick.js';
import { checkCatalog, diffCatalogs } from './catalog-diff.js';

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});
// deno-lint-ignore no-explicit-any
const must = ({ data, error }: { data: any; error: { message: string } | null }): any => { if (error) throw new Error(error.message); return data; };

// Apunta qué ha cambiado respecto al catálogo guardado y deja el nuevo como snapshot.
// deno-lint-ignore no-explicit-any
async function saveCatalog(cat: any, runId: number) {
  checkCatalog(cat);
  const prev = must(await sb.from('catalog_snapshot').select('data').eq('id', 1).maybeSingle());
  const { summary, changes } = diffCatalogs(prev?.data, cat);
  const sync = must(await sb.from('catalog_syncs').insert({
    run_id: runId, source: cat.source || null, generated_at: cat.generatedAt || new Date().toISOString(), summary,
  }).select('id').single());
  try {
    for (let i = 0; i < changes.length; i += 1000) {
      must(await sb.from('catalog_changes').insert(changes.slice(i, i + 1000).map(ch => ({ ...ch, sync_id: sync.id }))));
    }
    must(await sb.from('catalog_snapshot').upsert({
      id: 1,
      generated_at: cat.generatedAt || new Date().toISOString(),
      source: cat.source || null,
      designs: cat.designs.length,
      elements: cat.elements.length,
      data: cat,
      updated_at: new Date().toISOString(),
    }));
  } catch (e) {
    await sb.from('catalog_syncs').delete().eq('id', sync.id); // sin snapshot nuevo, el historial no vale
    throw e;
  }
  await sb.from('catalog_sync_runs').update({
    status: 'ok', finished_at: new Date().toISOString(),
    designs: cat.designs.length, elements: cat.elements.length, failed_pages: cat.failedPages?.length ?? 0,
  }).eq('id', runId);
  return { sync_id: sync.id, ...summary };
}

async function fail(runId: number, e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  await sb.from('catalog_sync_runs').update({ status: 'error', finished_at: new Date().toISOString(), error: msg }).eq('id', runId);
  return msg;
}

async function download(runId: number) {
  try { await saveCatalog(await fetchCatalog({ locale: Deno.env.get('LEGO_LOCALE') || 'es-es' }), runId); }
  catch (e) { await fail(runId, e); }
}

Deno.serve(async req => {
  const secret = Deno.env.get('CATALOG_CRON_SECRET');
  if (!secret || req.headers.get('x-cron-secret') !== secret) return new Response('Forbidden', { status: 403 });

  const trigger = new URL(req.url).searchParams.get('trigger') || 'cron';
  const incoming = trigger === 'import' || trigger === 'local';
  // deno-lint-ignore no-explicit-any
  let cat: any = null;
  if (incoming) {
    cat = (await req.json().catch(() => null))?.catalog;
    try { checkCatalog(cat); } catch (e) { return Response.json({ error: (e as Error).message }, { status: 400 }); }
  }

  const { data: running } = await sb.from('catalog_sync_runs').select('id')
    .eq('status', 'running').gt('started_at', new Date(Date.now() - 15 * 60_000).toISOString()).limit(1);
  if (running?.length) {
    return incoming
      ? Response.json({ error: 'Hay una actualización del catálogo en curso; prueba dentro de un par de minutos.' }, { status: 409 })
      : Response.json({ ok: true, already: running[0].id });
  }

  const { data, error } = await sb.from('catalog_sync_runs').insert({ trigger }).select('id').single();
  if (error) return Response.json({ error: error.message }, { status: 500 });

  if (incoming) {
    try { return Response.json({ ok: true, run: data.id, result: await saveCatalog(cat, data.id) }); }
    catch (e) { return Response.json({ error: await fail(data.id, e) }, { status: 500 }); }
  }
  // La descarga tarda ~1 min: respondemos ya y seguimos en segundo plano.
  EdgeRuntime.waitUntil(download(data.id));
  return Response.json({ ok: true, run: data.id }, { status: 202 });
});
