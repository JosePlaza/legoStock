<script setup>
import { ref, computed, onMounted, onBeforeUnmount, inject } from 'vue';
import { api, img, eur, num, fmtDate, swatchBg, onImgError } from '../api.js';
import BrickSpinner from './BrickSpinner.vue';

const props = defineProps({ meta: Object });
const emit = defineEmits(['close', 'updated']);
const notify = inject('notify', () => {});

const job = ref(null);
const changes = ref(null);
const type = ref('');
const fileInput = ref(null);
const importing = ref(false);
let poll;

const TYPES = {
  agotado: { label: 'Se han agotado', cls: 'bad' },
  repuesto: { label: 'Vuelven a estar', cls: 'ok' },
  precio: { label: 'Cambio de precio', cls: 'warn' },
  nuevo: { label: 'Nuevas', cls: 'ok' },
  retirado: { label: 'Retiradas', cls: 'muted' },
};

async function loadChanges(t) {
  changes.value = await api.changes(t ? { type: t } : {});
  if (!t) {
    const first = Object.keys(TYPES).find(k => changes.value.counts[k]);
    if (first) { type.value = first; changes.value = await api.changes({ type: first }); }
  }
}
async function pickType(t) { type.value = t; changes.value = await api.changes({ type: t }); }

async function refreshJob() {
  job.value = await api.syncStatus();
  if (job.value.running) { poll = setTimeout(refreshJob, 1000); return; }
  if (job.value.result && job.value.finishedAt && Date.now() - new Date(job.value.finishedAt) < 5000) {
    notify(resultText(job.value.result));
    emit('updated');
    await loadChanges();
  }
}
async function startSync() {
  job.value = await api.startSync();
  refreshJob();
}
const resultText = r => r.firstImport
  ? `Catálogo cargado: ${num(r.designs)} piezas`
  : `Catálogo actualizado: ${r.soldout} agotadas, ${r.restocked} repuestas, ${r.price} cambios de precio, ${r.new} nuevas, ${r.removed} retiradas`;

async function onFile(ev) {
  const f = ev.target.files[0];
  ev.target.value = '';
  if (!f) return;
  importing.value = true;
  try {
    const r = await api.importCatalog(await f.text());
    notify(resultText(r));
    emit('updated');
    await loadChanges();
  } catch (e) { notify('Error al importar: ' + e.message); }
  finally { importing.value = false; }
}

const pct = computed(() => (job.value?.pages ? Math.round((job.value.page / job.value.pages) * 100) : 0));
const c = computed(() => props.meta.catalog);
const color = id => props.meta.colorsById[id];
const onKey = e => { if (e.key === 'Escape') emit('close'); };
onMounted(async () => {
  window.addEventListener('keydown', onKey);
  job.value = await api.syncStatus();
  if (job.value.running) refreshJob();
  loadChanges();
});
onBeforeUnmount(() => { clearTimeout(poll); window.removeEventListener('keydown', onKey); });
</script>

<template>
  <div class="overlay" @click.self="$emit('close')">
    <div class="modal wide">
      <button class="close" @click="$emit('close')" aria-label="Cerrar">×</button>
      <div class="pad">
        <h2>Catálogo de Pick a Brick</h2>
        <p class="muted">
          Última actualización: <b>{{ fmtDate(c.importedAt || c.generatedAt) }}</b> ·
          {{ num(c.designs) }} piezas · {{ num(c.elements) }} variantes ·
          <span class="ok-t">{{ num(c.available) }} disponibles</span> ·
          <span class="bad-t">{{ num(c.soldout) }} agotadas</span>
          <template v-if="c.removed"> · {{ num(c.removed) }} retiradas</template>
        </p>

        <div class="sync-box">
          <div>
            <b>Actualizar desde LEGO</b>
            <div v-if="c.canManage" class="muted small">Vuelve a descargar todo Pick a Brick (~1–2 min) y actualiza precios, agotados y piezas nuevas. Tu stock y tus proyectos no se tocan.</div>
            <div class="muted small" v-if="c.nextSyncAt">Supabase lo actualiza solo cada día · próxima: {{ fmtDate(c.nextSyncAt) }}</div>
            <div class="bad-t small" v-if="c.remoteRun?.status === 'error'">La actualización automática del {{ fmtDate(c.remoteRun.started_at) }} falló: {{ c.remoteRun.error }}</div>
          </div>
          <button v-if="c.canManage" class="btn" :disabled="job?.running" @click="startSync">{{ job?.running ? 'Descargando…' : 'Actualizar ahora' }}</button>
        </div>
        <div v-if="job?.running" class="progress">
          <template v-if="job.pages">
            <div class="bar"><i :style="{ width: pct + '%' }"></i></div>
            <span class="small muted">Página {{ job.page }} de {{ job.pages }}</span>
          </template>
          <BrickSpinner v-else :size="32" label="Supabase está descargando el catálogo (~1–2 min)…" />
        </div>
        <div v-if="job?.error && !job.running" class="banner error">
          <b>No se ha podido descargar:</b> {{ job.error }}<br />
          <span class="small">Alternativa: abre Pick a Brick en Chrome, pega <code>scripts/extract-catalog.js</code> en la consola y sube aquí el archivo que descarga.</span>
        </div>
        <div v-if="c.canManage" class="muted small">
          ¿Tienes un <code>legostock-catalog.json</code>?
          <button class="linkbtn" :disabled="importing" @click="fileInput.click()">{{ importing ? 'Importando…' : 'Importar archivo' }}</button>
          <input ref="fileInput" type="file" accept=".json,application/json" hidden @change="onFile" />
        </div>

        <template v-if="changes?.sync">
          <h3>Cambios en la última actualización <small class="muted">({{ fmtDate(changes.sync.created_at) }})</small></h3>
          <p v-if="changes.sync.summary.firstImport" class="muted">Fue la primera carga del catálogo, así que todavía no hay cambios que comparar.</p>
          <template v-else>
            <div class="seg">
              <button v-for="(x, k) in TYPES" :key="k" :class="{ on: type === k }" :disabled="!changes.counts[k]" @click="pickType(k)">
                {{ x.label }} <span>{{ changes.counts[k] || 0 }}</span>
              </button>
            </div>
            <div v-if="!changes.items.length" class="muted pad-y">Sin cambios de este tipo.</div>
            <ul class="changes">
              <li v-for="it in changes.items" :key="it.id">
                <img :src="img(it.element_id)" loading="lazy" referrerpolicy="no-referrer" @error="onImgError" />
                <div class="grow">
                  <div class="pname">{{ it.design_name || it.design_id }}</div>
                  <div class="muted small">
                    <span class="dot" :style="{ background: swatchBg(color(it.color_id)) }"></span>
                    {{ color(it.color_id)?.name }} · ID {{ it.design_id }} · Elem. {{ it.element_id }}
                  </div>
                </div>
                <span v-if="it.type === 'precio'" class="small">{{ eur(it.old_value) }} → <b :class="it.new_value > it.old_value ? 'bad-t' : 'ok-t'">{{ eur(it.new_value) }}</b></span>
                <span v-if="it.qty" class="status ok">Tienes {{ it.qty }}</span>
              </li>
            </ul>
          </template>
        </template>
      </div>
    </div>
  </div>
</template>
