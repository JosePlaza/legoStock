<script setup>
import { ref, onMounted, watch } from 'vue';
import { api, onImgError } from '../api.js';
import ItemDetail from './ItemDetail.vue';
import IntegrationNotice from './IntegrationNotice.vue';
import SettingsModal from './SettingsModal.vue';

const type = ref('SET');
const q = ref('');
const res = ref(null);
const page = ref(1);
const loading = ref(false);
const err = ref('');
const integrations = ref(null);
const open = ref(null);
const showSettings = ref(false);

onMounted(async () => { integrations.value = await api.integrations(); });

async function run(p = 1) {
  if (!q.value.trim()) return;
  loading.value = true; err.value = ''; page.value = p;
  try {
    const r = await api.search({ type: type.value, q: q.value.trim(), page: p });
    res.value = p === 1 ? r : { ...r, results: res.value.results.concat(r.results) };
  } catch (e) { err.value = e.message; }
  finally { loading.value = false; }
}
watch(type, () => { res.value = null; if (q.value.trim()) run(1); });
</script>

<template>
  <div class="search-page">
    <div class="page-head">
      <h1>Buscar</h1>
      <button class="btn ghost small" @click="showSettings = true">⚙ Ajustes de precio y envío</button>
    </div>
    <IntegrationNotice :integrations="integrations" />
    <form class="search-bar" @submit.prevent="run(1)">
      <div class="seg">
        <button type="button" :class="{ on: type === 'SET' }" @click="type = 'SET'">Sets</button>
        <button type="button" :class="{ on: type === 'PART' }" @click="type = 'PART'">Piezas</button>
      </div>
      <input class="search" v-model="q" :placeholder="type === 'SET' ? 'Nombre o número de set (p. ej. Millennium, 75192)' : 'Nombre o número de pieza (p. ej. brick 2x4, 3001)'" />
      <button class="btn" :disabled="loading || !q.trim()">{{ loading ? 'Buscando…' : 'Buscar' }}</button>
    </form>
    <div v-if="err" class="banner error">{{ err }}</div>
    <div v-if="res?.notice" class="muted small">{{ res.notice }}</div>
    <div v-if="res && !res.results.length && !loading" class="empty">Sin resultados.</div>
    <div v-if="res" class="muted small results-count">{{ res.count }} resultados</div>
    <div class="grid">
      <article v-for="r in res?.results || []" :key="r.type + r.no" class="card" @click="open = r" tabindex="0" @keyup.enter="open = r">
        <div v-if="r.owned" class="qty-badge" title="Las tienes en stock">{{ r.owned }}</div>
        <div class="thumb"><img :src="r.img" loading="lazy" referrerpolicy="no-referrer" @error="onImgError" /></div>
        <div class="card-body">
          <div class="name" :title="r.name">{{ r.name }}</div>
          <div class="id">{{ r.no }}<template v-if="r.year"> · {{ r.year }}</template></div>
          <div v-if="r.num_parts" class="id">{{ r.num_parts }} piezas</div>
        </div>
      </article>
    </div>
    <div class="sentinel"><button v-if="res?.next && !loading" class="btn ghost" @click="run(page + 1)">Cargar más</button></div>
    <ItemDetail v-if="open" :type="open.type" :no="open.no" @close="open = null" />
    <SettingsModal v-if="showSettings" @close="showSettings = false" />
  </div>
</template>
