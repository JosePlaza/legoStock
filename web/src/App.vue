<script setup>
import { ref, onMounted, onBeforeUnmount, provide, computed } from 'vue';
import { api, eur, num, fmtDate } from './api.js';
import CatalogView from './components/CatalogView.vue';
import ProjectsView from './components/ProjectsView.vue';
import WishlistView from './components/WishlistView.vue';
import SearchView from './components/SearchView.vue';
import CatalogModal from './components/CatalogModal.vue';
import LoginView from './components/LoginView.vue';
import MigrationBanner from './components/MigrationBanner.vue';
import LogoMark from './components/LogoMark.vue';
import BrickSpinner from './components/BrickSpinner.vue';
import { loadConfig, sb } from './supabase.js';

// Rutas sencillas por hash: #/catalogo, #/stock, #/proyectos, #/proyectos/12
const parse = () => {
  const h = location.hash.replace(/^#\/?/, '').split('/');
  if (h[0] === 'stock') return { tab: 'mine' };
  if (h[0] === 'proyectos') return { tab: 'projects', id: h[1] ? Number(h[1]) : null };
  if (h[0] === 'wishlist') return { tab: 'wishlist' };
  if (h[0] === 'buscar') return { tab: 'search' };
  return { tab: 'catalog' };
};
const route = ref(parse());
const onHash = () => { route.value = parse(); window.scrollTo(0, 0); };
onMounted(() => window.addEventListener('hashchange', onHash));
onBeforeUnmount(() => window.removeEventListener('hashchange', onHash));

const meta = ref(null);
const error = ref('');
const reloadKey = ref(0);
const showCatalog = ref(false);
const toast = ref('');
let toastTimer;
const notify = msg => { toast.value = msg; clearTimeout(toastTimer); toastTimer = setTimeout(() => (toast.value = ''), 4000); };
provide('notify', notify);

// ----- Sesión -----
const ready = ref(false);
const config = ref(null);
const session = ref(null);
const userEmail = computed(() => session.value?.user?.email || '');
async function logout() { await sb().auth.signOut(); }
const onExpired = () => sb()?.auth.signOut();

async function loadMeta(fresh) {
  try {
    const m = await api.meta(fresh);
    m.colorsById = Object.fromEntries(m.allColors.map(c => [c.id, c]));
    m.catsById = Object.fromEntries(m.categories.map(c => [c.id, c]));
    m.subsById = Object.fromEntries(m.subcategories.map(c => [c.id, c]));
    meta.value = m;
    error.value = '';
  } catch (e) {
    error.value = 'No puedo conectar con la API (' + e.message + ').';
  }
}
onMounted(async () => {
  window.addEventListener('auth:expired', onExpired);
  try {
    config.value = await loadConfig();
  } catch (e) {
    error.value = e.message;
    ready.value = true;
    return;
  }
  if (config.value.configured) {
    const { data } = await sb().auth.getSession();
    session.value = data.session;
    sb().auth.onAuthStateChange((evt, s) => {
      const changedUser = (s?.user?.id || null) !== (session.value?.user?.id || null);
      session.value = s;
      if (changedUser) { meta.value = null; if (s) loadMeta(true); }
    });
    if (session.value) await loadMeta(true);
  }
  ready.value = true;
});
onBeforeUnmount(() => window.removeEventListener('auth:expired', onExpired));
// Si la pestaña lleva tiempo abierta, al volver a ella refrescamos (y traemos el catálogo nuevo de Supabase).
let metaAt = Date.now();
const onVisible = () => {
  if (document.visibilityState !== 'visible' || !session.value || Date.now() - metaAt < 10 * 60_000) return;
  metaAt = Date.now();
  loadMeta(true).then(() => reloadKey.value++);
};
onMounted(() => document.addEventListener('visibilitychange', onVisible));
onBeforeUnmount(() => document.removeEventListener('visibilitychange', onVisible));
async function onCatalogUpdated() { await loadMeta(); reloadKey.value++; }
async function onMigrated() { await loadMeta(true); reloadKey.value++; }

const catalogAge = computed(() => {
  const d = meta.value?.catalog.importedAt || meta.value?.catalog.generatedAt;
  return d ? Math.floor((Date.now() - new Date(d)) / 86400000) : null;
});
</script>

<template>
  <div v-if="!ready" class="splash"><BrickSpinner :size="96" /></div>
  <div v-else-if="config && !config.configured" class="auth-page">
    <div class="auth-card">
      <div class="brand big"><LogoMark />LegoStock</div>
      <h3>Falta conectar con Supabase</h3>
      <ol class="small">
        <li>Crea un proyecto en supabase.com.</li>
        <li>En <b>SQL Editor</b> ejecuta el archivo <code>supabase/schema.sql</code>.</li>
        <li>En <b>Authentication → Sign In / Providers → Email</b> desactiva «Confirm email».</li>
        <li>Copia la URL y la clave <i>anon / publishable</i> (Project Settings → API) en el archivo <code>.env</code>.</li>
        <li>Reinicia <code>npm run dev</code>.</li>
      </ol>
      <p class="small muted">Tu stock actual sigue guardado en este ordenador; cuando entres podrás importarlo a tu cuenta.</p>
    </div>
  </div>
  <div v-else-if="!session && !error" class="auth-wrap"><LoginView /></div>
  <div v-else class="app">
    <header class="topbar">
      <a class="brand" href="#/catalogo"><LogoMark />LegoStock</a>
      <nav class="tabs">
        <a :class="{ on: route.tab === 'catalog' }" href="#/catalogo">Catálogo</a>
        <a :class="{ on: route.tab === 'mine' }" href="#/stock">Mi stock</a>
        <a :class="{ on: route.tab === 'projects' }" href="#/proyectos">Proyectos</a>
        <a :class="{ on: route.tab === 'wishlist' }" href="#/wishlist">Wishlist</a>
        <a :class="{ on: route.tab === 'search' }" href="#/buscar">Buscar</a>
      </nav>
      <div class="stats" v-if="meta">
        <span><b>{{ num(meta.totals.pieces) }}</b> piezas</span>
        <span><b>{{ num(meta.totals.lots) }}</b> lotes</span>
        <span><b>{{ eur(meta.totals.value_cents) }}</b></span>
      </div>
      <button class="btn ghost small" @click="showCatalog = true" title="Estado del catálogo y actualizar desde LEGO">
        ↻ Catálogo
        <span v-if="catalogAge !== null" class="age" :class="{ old: catalogAge > 14 }">{{ catalogAge === 0 ? 'hoy' : catalogAge + ' d' }}</span>
      </button>
      <div v-if="session" class="user">
        <span class="user-email" :title="userEmail">{{ userEmail }}</span>
        <button class="btn ghost small" @click="logout">Salir</button>
      </div>
    </header>

    <main>
      <div v-if="error" class="banner error">{{ error }}</div>
      <div v-if="!meta && !error" class="loading-block"><BrickSpinner :size="72" label="Cargando tu stock…" /></div>
      <MigrationBanner v-if="session && meta" :key="session.user.id" @done="onMigrated" />
      <template v-if="meta">
        <div v-if="!meta.catalog.designs" class="banner">
          No hay catálogo cargado. Pulsa «↻ Catálogo» y después «Actualizar desde LEGO».
        </div>
        <WishlistView v-else-if="route.tab === 'wishlist'" @changed="loadMeta" />
        <SearchView v-else-if="route.tab === 'search'" />
        <ProjectsView v-else-if="route.tab === 'projects'" :key="'p' + route.id" :meta="meta" :project-id="route.id" @changed="loadMeta" />
        <CatalogView v-else :key="route.tab + reloadKey" :owned="route.tab === 'mine'" :meta="meta" @changed="loadMeta" />
      </template>
    </main>

    <footer class="foot" v-if="meta?.catalog.generatedAt">
      Catálogo Pick a Brick del {{ fmtDate(meta.catalog.generatedAt) }} ·
      {{ num(meta.catalog.designs) }} piezas · {{ num(meta.catalog.elements) }} variantes ({{ num(meta.catalog.soldout) }} agotadas) · imágenes y precios © LEGO
    </footer>
    <CatalogModal v-if="showCatalog && meta" :meta="meta" @close="showCatalog = false" @updated="onCatalogUpdated" />
    <transition name="fade"><div v-if="toast" class="toast">{{ toast }}</div></transition>
  </div>
</template>
