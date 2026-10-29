<script setup>
import { ref, computed, onMounted, inject } from 'vue';
import { api, img, eur, num, fmtDate, fmtSize, projectCover, downloadUrl, onImgError } from '../api.js';
import CompareView from './CompareView.vue';
import PieceDialog from './PieceDialog.vue';
import BrickSpinner from './BrickSpinner.vue';

const props = defineProps({ id: Number, meta: Object });
const emit = defineEmits(['changed']);
const notify = inject('notify', () => {});

const data = ref(null);
const loading = ref(true);
const name = ref('');
const setNum = ref('');
const notes = ref('');
const viewing = ref(null);
const piece = ref(null);
const showLinkForm = ref(false);
const toggleView = f => { viewing.value = viewing.value?.id === f.id ? null : f; };
const confirm = ref('');
const uploading = ref(false);
const dragging = ref(false);

async function load() {
  loading.value = true;
  try {
    data.value = await api.project(props.id);
    const p = data.value.project;
    name.value = p.name; setNum.value = p.set_num || ''; notes.value = p.notes || '';
  } catch (e) { notify('Error: ' + e.message); }
  finally { loading.value = false; }
}
onMounted(load);

const p = computed(() => data.value?.project);
const s = computed(() => data.value?.result?.summary);

async function save(fields) {
  try { const r = await api.updateProject(props.id, fields); data.value.project = { ...data.value.project, ...r, cover_url: data.value.project.cover_url }; }
  catch (e) { notify('Error: ' + e.message); }
}
const saveName = () => name.value.trim() && name.value !== p.value.name && save({ name: name.value.trim() });
const saveSet = () => setNum.value !== (p.value.set_num || '') && save({ set_num: setNum.value.trim() });
const saveNotes = () => notes.value !== (p.value.notes || '') && save({ notes: notes.value });
async function toggleSpares(e) { await save({ include_spares: e.target.checked }); await load(); }

// Alternativas de color: true = se pueden usar, false = descartadas para esa línea
async function toggleAlt(key, allow) {
  const cur = new Set(p.value.no_alt || []);
  if (allow) cur.delete(key); else cur.add(key);
  await save({ no_alt: [...cur] });
  await load();
}
async function setAltAll(allow) {
  const keys = allow ? [] : [...new Set([...(p.value.no_alt || []), ...data.value.result.rows.filter(r => r.alt > 0).map(r => r.key)])];
  await save({ no_alt: keys });
  await load();
  notify(allow ? 'Alternativas de color restauradas' : 'Alternativas de color descartadas en todo el proyecto');
}

// ----- Enlaces -----
const newLink = ref({ url: '', title: '' });
const savingLink = ref(false);
const links = computed(() => p.value?.links || []);
async function addLink() {
  if (!newLink.value.url.trim()) return;
  savingLink.value = true;
  try {
    await save({ links: [...links.value, { url: newLink.value.url.trim(), title: newLink.value.title.trim() }] });
    newLink.value = { url: '', title: '' };
    showLinkForm.value = false;
  } finally { savingLink.value = false; }
}
const removeLink = i => save({ links: links.value.filter((_, j) => j !== i) });
const host = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
const favicon = u => `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host(u))}&sz=32`;

async function onPieceChanged() { emit('changed'); await load(); if (piece.value) piece.value = data.value.result.rows.find(r => r.key === piece.value.key) || piece.value; }

async function remap(rb, lego) {
  if (!lego) return;
  await api.setColorMap(rb, lego);
  notify(`Color Rebrickable ${rb} asignado`);
  await load();
}

async function addAll() {
  try {
    const r = await api.projectToStock(props.id);
    notify(`Añadidas ${num(r.added)} piezas a tu stock (${r.lots} lotes)${r.skipped ? ` · ${r.skipped} líneas sin identificar` : ''}`);
    confirm.value = '';
    emit('changed');
    await load();
  } catch (e) { notify('Error: ' + e.message); }
}
async function replaceCsv(e) {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  try { await api.replaceCsv(props.id, await f.text(), f.name); notify('Lista de piezas actualizada'); await load(); }
  catch (err) { notify('Error: ' + err.message); }
}
async function removeProject() {
  await api.deleteProject(props.id);
  notify('Proyecto eliminado');
  location.hash = '#/proyectos';
}

async function upload(files) {
  uploading.value = true;
  try {
    for (const f of files) {
      const r = await api.uploadFile(props.id, f);
      data.value.files.push(r);
    }
    notify(files.length > 1 ? `${files.length} archivos adjuntados` : 'Archivo adjuntado');
  } catch (e) { notify('Error al subir: ' + e.message); }
  finally { uploading.value = false; }
}
const onFiles = e => { const fs = [...e.target.files]; e.target.value = ''; if (fs.length) upload(fs); };
const onDrop = e => { dragging.value = false; const fs = [...e.dataTransfer.files]; if (fs.length) upload(fs); };
async function removeFile(f) {
  await api.deleteFile(props.id, f.id);
  data.value.files = data.value.files.filter(x => x.id !== f.id);
  if (viewing.value?.id === f.id) viewing.value = null;
}
const icon = f => (f.mime === 'application/pdf' ? '📄' : f.mime.startsWith('image/') ? '🖼️' : '📎');
const cover = computed(() => (p.value ? projectCover(p.value, s.value?.cover_element) : null));
async function uploadCover(e) {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  try {
    const r = await api.uploadFile(props.id, f, { cover: true });
    data.value.files.push(r);
    data.value.project.cover_file_id = r.id;
    data.value.project.cover_url = r.url;
    notify('Imagen de portada actualizada');
  } catch (err) { notify('Error: ' + err.message); }
}
async function setCover(f) {
  await save({ cover_file_id: f ? f.id : null });
  data.value.project.cover_file_id = f ? f.id : null;
  data.value.project.cover_url = f ? f.url : null;
}
const onCoverError = e => {
  if (e.target.dataset.fb !== '1' && s.value?.cover_element) { e.target.dataset.fb = '1'; e.target.src = img(s.value.cover_element); }
  else onImgError(e);
};
</script>

<template>
  <div class="project">
    <a href="#/proyectos" class="back">← Proyectos</a>
    <div v-if="loading && !data" class="loading-block"><BrickSpinner /></div>
    <template v-if="data">
      <div class="phead">
        <div class="pcover">
          <img :key="cover" :src="cover" referrerpolicy="no-referrer" @error="onCoverError" />
          <div class="cover-actions">
            <label class="btn small">🖼️ {{ p.cover_file_id ? 'Cambiar imagen' : 'Subir imagen' }}<input type="file" accept="image/*" hidden @change="uploadCover" /></label>
            <button v-if="p.cover_file_id" class="btn ghost small" @click="setCover(null)" title="Volver a la foto del set o de una pieza">Quitar</button>
          </div>
        </div>
        <div class="pinfo">
          <input class="title-input" v-model="name" @blur="saveName" @keyup.enter="$event.target.blur()" />
          <div class="meta-row">
            <label>Nº de set <input class="mini" v-model="setNum" placeholder="ej. 10294-1" @blur="saveSet" @keyup.enter="$event.target.blur()" /></label>
            <span class="muted small">Creado {{ fmtDate(p.created_at) }}<template v-if="p.filename"> · {{ p.filename }}</template></span>
          </div>
          <div class="actions">
            <label class="check"><input type="checkbox" :checked="!!p.include_spares" @change="toggleSpares" /> Incluir repuestos</label>
            <label class="btn ghost small">Reemplazar CSV<input type="file" accept=".csv,text/csv,text/plain" hidden @change="replaceCsv" /></label>
            <template v-if="confirm !== 'add'"><button class="btn small" :disabled="!s" @click="confirm = 'add'">+ Añadir todo a mi stock</button></template>
            <template v-else>
              <span class="small">¿Sumar {{ num(s.pieces_needed) }} piezas a tu stock (p. ej. si ya tienes el set)?</span>
              <button class="btn small" @click="addAll">Sí</button><button class="btn ghost small" @click="confirm = ''">No</button>
            </template>
            <template v-if="confirm !== 'del'"><button class="btn ghost small danger" @click="confirm = 'del'">Eliminar</button></template>
            <template v-else>
              <span class="small">¿Eliminar el proyecto y sus archivos?</span>
              <button class="btn small danger-bg" @click="removeProject">Eliminar</button><button class="btn ghost small" @click="confirm = ''">Cancelar</button>
            </template>
          </div>
        </div>
      </div>

      <div v-if="data.error" class="banner error">{{ data.error }}</div>
      <template v-if="s">
        <div class="summary">
          <div class="kpi wide2"><span>Completado</span><b>{{ s.pct }}%</b>
            <span v-if="s.pieces_alt" class="alt-pct">{{ s.pct_alt }}% con otros colores</span>
            <div class="bar dual"><i :style="{ width: s.pct + '%' }"></i><i class="alt" :style="{ width: (s.pct_alt - s.pct) + '%' }"></i></div>
          </div>
          <div class="kpi"><span>Piezas necesarias</span><b>{{ num(s.pieces_needed) }}</b></div>
          <div class="kpi ok"><span>Tengo</span><b>{{ num(s.pieces_have) }}</b></div>
          <div class="kpi bad"><span>Me faltan</span><b>{{ num(s.pieces_missing) }}</b></div>
          <div class="kpi alt-k" v-if="s.pieces_alt"><span>Alternativas de color</span><b>+{{ num(s.pieces_alt) }}</b><span class="small muted">en {{ s.lines_alt }} líneas</span></div>
          <div class="kpi"><span>Coste de lo que falta*</span><b>{{ eur(s.missing_value_cents) }}</b>
            <span v-if="s.pieces_alt" class="small muted">{{ eur(s.missing_alt_value_cents) }} usando otros colores</span></div>
        </div>
        <p class="muted small">
          {{ s.lines }} líneas: {{ s.lines_ok }} completas, {{ s.lines_partial }} parciales, {{ s.lines_missing }} sin ninguna, {{ s.lines_unresolved }} sin identificar.
          <template v-if="s.missing_soldout_lines"> <b class="bad-t">{{ s.missing_soldout_lines }} de las que faltan están agotadas o retiradas en LEGO.</b></template>
          <template v-if="s.skipped_spares"> Se ignoran {{ s.skipped_spares }} piezas de repuesto.</template>
          *Precios de Pick a Brick; {{ s.missing_unpriced_lines }} líneas sin precio.
        </p>
      </template>

      <section class="files-box">
        <div class="files-head">
          <h3>Instrucciones, archivos y enlaces <small class="muted">{{ data.files.length + links.length || '' }}</small></h3>
          <div class="actions">
            <label class="btn ghost small">{{ uploading ? 'Subiendo…' : '+ Archivo' }}<input type="file" multiple accept="application/pdf,image/*,.pdf" hidden @change="onFiles" /></label>
            <button class="btn ghost small" @click="showLinkForm = !showLinkForm">+ Enlace</button>
          </div>
        </div>
        <form v-if="showLinkForm" class="link-add" @submit.prevent="addLink">
          <input class="search" v-model="newLink.url" type="text" inputmode="url" placeholder="Pega un enlace (instrucciones online, vídeo, tienda, Rebrickable…)" autofocus />
          <input class="search" v-model="newLink.title" placeholder="Título (opcional)" />
          <button class="btn small" :disabled="savingLink || !newLink.url.trim()">Añadir</button>
        </form>
        <div class="res-list" :class="{ over: dragging }" @dragover.prevent="dragging = true" @dragleave="dragging = false" @drop.prevent="onDrop">
          <div v-if="!data.files.length && !links.length" class="muted small pad-y">Arrastra aquí el PDF de instrucciones o imágenes, o añade un enlace.</div>
          <div v-for="f in data.files" :key="'f' + f.id" class="res-row" :class="{ on: viewing?.id === f.id }">
            <button class="fname" :title="f.mime === 'application/pdf' || f.mime.startsWith('image/') ? 'Ver aquí' : 'Descargar'" @click="toggleView(f)">
              <span class="res-ico">{{ icon(f) }}</span> {{ f.filename }}
              <span class="muted small">{{ fmtSize(f.size) }}</span>
            </button>
            <span v-if="viewing?.id === f.id" class="small muted">viendo</span>
            <button v-if="f.mime.startsWith('image/')" class="iconbtn" :class="{ star: p.cover_file_id === f.id }" :title="p.cover_file_id === f.id ? 'Es la portada' : 'Usar como portada'" @click="setCover(p.cover_file_id === f.id ? null : f)">★</button>
            <a class="iconbtn" :href="downloadUrl(f)" title="Descargar">⬇</a>
            <a class="iconbtn" :href="f.url" target="_blank" rel="noopener" title="Abrir en pestaña nueva">↗</a>
            <button class="iconbtn" title="Eliminar" @click="removeFile(f)">✕</button>
          </div>
          <div v-for="(l, i) in links" :key="'l' + i" class="res-row">
            <a :href="l.url" target="_blank" rel="noopener" class="fname">
              <img class="res-ico" :src="favicon(l.url)" alt="" width="16" height="16" referrerpolicy="no-referrer" />
              {{ l.title }} <span class="muted small">{{ host(l.url) }}</span>
            </a>
            <a class="iconbtn" :href="l.url" target="_blank" rel="noopener" title="Abrir">↗</a>
            <button class="iconbtn" title="Quitar enlace" @click="removeLink(i)">✕</button>
          </div>
        </div>
        <div v-if="viewing" class="viewer">
          <div class="viewer-bar"><b class="small">{{ viewing.filename }}</b><button class="btn ghost small" @click="viewing = null">Cerrar visor ✕</button></div>
          <iframe v-if="viewing.mime === 'application/pdf'" :src="viewing.url" title="Instrucciones"></iframe>
          <img v-else-if="viewing.mime.startsWith('image/')" :src="viewing.url" />
          <div v-else class="muted pad-y">Este tipo de archivo no se puede previsualizar. <a :href="downloadUrl(viewing)">Descargar</a></div>
        </div>
        <label class="muted small notes-lbl">Notas</label>
        <textarea class="notes-area" v-model="notes" rows="3" placeholder="Notas del proyecto (dónde lo guardas, qué falta pedir…)" @blur="saveNotes"></textarea>
      </section>

      <h3>Piezas</h3>
      <CompareView v-if="data.result" :result="data.result" :meta="meta" :base-name="p.name" editable-alt
        @remap="remap" @toggle-alt="toggleAlt" @set-alt-all="setAltAll" @open="r => (piece = r)" />
      <PieceDialog v-if="piece" :row="piece" :meta="meta" @close="piece = null" @changed="onPieceChanged" />
    </template>
  </div>
</template>
