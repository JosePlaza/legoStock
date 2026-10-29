<script setup>
import { ref, computed, onMounted, inject } from 'vue';
import { api, img, eur, num, fmtDate, projectCover, onImgError } from '../api.js';
import ProjectDetail from './ProjectDetail.vue';

const props = defineProps({ meta: Object, projectId: Number });
const emit = defineEmits(['changed']);
const notify = inject('notify', () => {});

const list = ref(null);
const sort = ref('recent');
const creating = ref(false);
const draft = ref({ csv: '', filename: '', name: '', spares: false, image: null });
const preview = ref(null);
function onImage(e) {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  draft.value.image = f;
  if (preview.value) URL.revokeObjectURL(preview.value);
  preview.value = URL.createObjectURL(f);
}
const dragging = ref(false);
const busy = ref(false);

async function load() { list.value = await api.projects(); }
onMounted(() => { if (!props.projectId) load(); });

const sorted = computed(() => {
  const l = [...(list.value || [])];
  if (sort.value === 'pct') l.sort((a, b) => (b.summary.pct || 0) - (a.summary.pct || 0));
  else if (sort.value === 'cost') l.sort((a, b) => (a.summary.missing_value_cents || 0) - (b.summary.missing_value_cents || 0));
  else if (sort.value === 'name') l.sort((a, b) => a.name.localeCompare(b.name));
  return l;
});

async function readFile(f) {
  draft.value.csv = await f.text();
  draft.value.filename = f.name;
  if (!draft.value.name) draft.value.name = f.name.replace(/\.(csv|txt)$/i, '').replace(/^rebrickable_parts_/i, '').replace(/[_]+/g, ' ');
  creating.value = true;
}
const onFile = e => { const f = e.target.files[0]; e.target.value = ''; if (f) readFile(f); };
const onDrop = e => { dragging.value = false; const f = e.dataTransfer.files[0]; if (f) readFile(f); };
function cancel() { creating.value = false; draft.value = { csv: '', filename: '', name: '', spares: false, image: null }; if (preview.value) URL.revokeObjectURL(preview.value); preview.value = null; }

async function create() {
  busy.value = true;
  try {
    const p = await api.createProject(draft.value.csv, draft.value);
    if (draft.value.image) await api.uploadFile(p.id, draft.value.image, { cover: true });
    notify(`Proyecto «${p.name}» creado`);
    cancel();
    location.hash = '#/proyectos/' + p.id;
  } catch (e) { notify('Error: ' + e.message); }
  finally { busy.value = false; }
}
const cover = p => projectCover(p, p.summary.cover_element);
const onCoverError = (e, p) => {
  if (e.target.dataset.fb !== '1' && p.summary.cover_element) { e.target.dataset.fb = '1'; e.target.src = img(p.summary.cover_element); }
  else onImgError(e);
};
</script>

<template>
  <ProjectDetail v-if="projectId" :id="projectId" :meta="meta" @changed="emit('changed')" />

  <div v-else class="projects">
    <div class="page-head">
      <h1>Proyectos</h1>
      <div class="actions">
        <select v-model="sort" class="auto">
          <option value="recent">Más recientes</option>
          <option value="pct">Más completos</option>
          <option value="cost">Menos coste restante</option>
          <option value="name">Nombre</option>
        </select>
        <label class="btn">+ Nuevo proyecto<input type="file" accept=".csv,text/csv,text/plain" hidden @change="onFile" /></label>
      </div>
    </div>

    <div v-if="creating" class="create-box">
      <div class="muted small">Archivo: <b>{{ draft.filename }}</b></div>
      <label class="lbl">Nombre del proyecto</label>
      <input v-model="draft.name" class="search" placeholder="p. ej. 10294 Titanic" @keyup.enter="create" />
      <label class="check"><input type="checkbox" v-model="draft.spares" /> Incluir piezas de repuesto (spare)</label>
      <div class="cover-pick">
        <img v-if="preview" :src="preview" />
        <label class="btn ghost small">{{ preview ? 'Cambiar imagen' : '🖼️ Añadir imagen de portada (opcional)' }}<input type="file" accept="image/*" hidden @change="onImage" /></label>
        <span class="muted small">Si no la pones, se usa la foto del set (si el archivo lleva su nº) o una pieza de la lista.</span>
      </div>
      <div class="actions">
        <button class="btn" :disabled="busy || !draft.name.trim()" @click="create">Crear proyecto</button>
        <button class="btn ghost" @click="cancel">Cancelar</button>
      </div>
    </div>

    <div v-else class="drop" :class="{ over: dragging }" @dragover.prevent="dragging = true" @dragleave="dragging = false" @drop.prevent="onDrop">
      <div><b>Arrastra aquí un CSV de Rebrickable</b> para crear un proyecto nuevo</div>
      <div class="muted small">Export de un set o lista (<code>Part,Color,Quantity</code>) o <code>inventory_parts.csv</code>. Si el nombre del archivo lleva el nº de set (p. ej. <code>10294-1</code>), se usa su foto.</div>
    </div>

    <div v-if="list && !list.length" class="empty">Aún no tienes proyectos.</div>
    <div class="pgrid">
      <a v-for="p in sorted" :key="p.id" class="pcard" :href="'#/proyectos/' + p.id">
        <div class="pthumb"><img :src="cover(p)" loading="lazy" referrerpolicy="no-referrer" @error="e => onCoverError(e, p)" /></div>
        <div class="pbody">
          <div class="ptitle">{{ p.name }}</div>
          <div class="muted small">
            <template v-if="p.set_num">Set {{ p.set_num }} · </template>{{ num(p.summary.pieces_needed) }} piezas · {{ fmtDate(p.updated_at) }}
            <template v-if="p.files"> · 📎 {{ p.files }}</template>
            <template v-if="p.links?.length"> · 🔗 {{ p.links.length }}</template>
          </div>
          <template v-if="!p.summary.error">
            <div class="pct-row">
              <div class="bar dual"><i :style="{ width: p.summary.pct + '%' }" :class="{ full: p.summary.pct >= 100 }"></i><i class="alt" :style="{ width: ((p.summary.pct_alt || p.summary.pct) - p.summary.pct) + '%' }"></i></div>
              <b>{{ p.summary.pct }}%</b>
            </div>
            <div v-if="p.summary.pieces_alt" class="alt-pct small">{{ p.summary.pct_alt }}% usando otros colores (+{{ num(p.summary.pieces_alt) }})</div>
            <div class="pfoot">
              <span v-if="p.summary.pieces_missing">Faltan <b>{{ num(p.summary.pieces_missing) }}</b> · <b>{{ eur(p.summary.missing_value_cents) }}</b></span>
              <span v-else class="ok-t"><b>¡Completo!</b></span>
              <span v-if="p.summary.missing_soldout_lines" class="bad-t small" title="Líneas que te faltan y están agotadas o retiradas en LEGO">{{ p.summary.missing_soldout_lines }} agotadas</span>
            </div>
          </template>
          <div v-else class="bad-t small">{{ p.summary.error }}</div>
        </div>
      </a>
    </div>
  </div>
</template>
