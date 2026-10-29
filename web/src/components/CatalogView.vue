<script setup>
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { api, num, swatchBg } from '../api.js';
import PartCard from './PartCard.vue';
import PartModal from './PartModal.vue';
import BrickSpinner from './BrickSpinner.vue';

const props = defineProps({ owned: Boolean, meta: Object });
const emit = defineEmits(['changed']);

const f = reactive({ q: '', cat: '', sub: '', color: '', avail: '', sort: props.owned ? 'qty' : 'relevance' });
const items = ref([]);
const total = ref(0);
const loading = ref(false);
const done = ref(false);
const selected = ref(null);
const sentinel = ref(null);
const showFilters = ref(false);
const LIMIT = 48;
let reqId = 0;

async function load(reset) {
  if (loading.value && !reset) return;
  const my = ++reqId;
  loading.value = true;
  try {
    const params = { limit: LIMIT, offset: reset ? 0 : items.value.length, sort: f.sort };
    for (const k of ['q', 'cat', 'sub', 'color', 'avail']) if (f[k]) params[k] = f[k];
    if (props.owned) params.owned = 1;
    const r = await api.designs(params);
    if (my !== reqId) return;
    items.value = reset ? r.items : items.value.concat(r.items);
    total.value = r.total;
    done.value = items.value.length >= r.total;
  } finally {
    if (my === reqId) loading.value = false;
  }
  await nextTick();
  checkSentinel();
}

let timer;
watch(() => f.cat, () => (f.sub = ''));
watch(() => ({ ...f }), (n, o) => {
  clearTimeout(timer);
  timer = setTimeout(() => load(true), n.q !== o.q ? 250 : 0);
});

let obs;
function checkSentinel() {
  const el = sentinel.value;
  if (!el || done.value || loading.value) return;
  if (el.getBoundingClientRect().top < window.innerHeight + 600) load(false);
}
onMounted(() => {
  load(true);
  obs = new IntersectionObserver(es => es[0].isIntersecting && checkSentinel(), { rootMargin: '600px' });
  obs.observe(sentinel.value);
});
onBeforeUnmount(() => obs?.disconnect());

const subs = computed(() => (f.cat ? props.meta.subcategories.filter(s => s.category_id === f.cat && s.n > 0) : []));
const colorGroups = computed(() => {
  const g = {};
  for (const c of props.meta.colors) (g[c.family || 'Otros'] ||= []).push(c);
  return Object.entries(g);
});
const hasFilters = computed(() => f.q || f.cat || f.sub || f.color || f.avail);
function resetFilters() { Object.assign(f, { q: '', cat: '', sub: '', color: '', avail: '' }); }

function onUpdated(d) {
  const i = items.value.findIndex(x => x.design_id === d.design_id);
  if (i >= 0) {
    if (props.owned && d.total_qty === 0) { /* se queda visible hasta recargar, para poder deshacer */ }
    items.value[i] = d;
  }
  selected.value = d;
  emit('changed');
}
</script>

<template>
  <div class="catalog">
    <aside class="filters" :class="{ open: showFilters }">
      <input class="search" v-model="f.q" type="search" placeholder="Buscar nombre, ID o nº de elemento…" />
      <label class="lbl">Ordenar por</label>
      <select v-model="f.sort">
        <option value="relevance">Relevancia (como en LEGO)</option>
        <option value="qty">Más en stock</option>
        <option value="name">Nombre</option>
        <option value="price">Precio: menor a mayor</option>
        <option value="price_desc">Precio: mayor a menor</option>
      </select>

      <label class="lbl">Disponibilidad en LEGO</label>
      <select v-model="f.avail">
        <option value="">Todas</option>
        <option value="available">Disponibles</option>
        <option value="soldout">Agotadas / retiradas</option>
      </select>

      <h4>Categoría</h4>
      <ul class="cats">
        <li :class="{ on: !f.cat }" @click="f.cat = ''">Todas</li>
        <template v-for="c in meta.categories" :key="c.id">
          <li v-if="c.n" :class="{ on: f.cat === c.id }" @click="f.cat = f.cat === c.id ? '' : c.id">{{ c.name }} <span>{{ c.n }}</span></li>
          <ul v-if="f.cat === c.id && subs.length" class="subs">
            <li v-for="s in subs" :key="s.id" :class="{ on: f.sub === s.id }" @click="f.sub = f.sub === s.id ? '' : s.id">{{ s.name }} <span>{{ s.n }}</span></li>
          </ul>
        </template>
      </ul>

      <h4>Color <small v-if="f.color" class="muted">· {{ meta.colorsById[f.color]?.name }}</small></h4>
      <div v-for="[fam, cols] in colorGroups" :key="fam" class="swatch-group">
        <div class="fam">{{ fam }}</div>
        <div class="swatches">
          <button v-for="c in cols" :key="c.id" class="sw" :class="{ on: f.color === c.id }" :style="{ background: swatchBg(c) }"
            :title="`${c.name} (${c.n})`" @click="f.color = f.color === c.id ? '' : c.id"></button>
        </div>
      </div>
      <button v-if="hasFilters" class="btn ghost small full" @click="resetFilters">Limpiar filtros</button>
    </aside>

    <section class="results">
      <div class="results-head">
        <button class="btn ghost small only-mobile" @click="showFilters = !showFilters">Filtros</button>
        <span><b>{{ num(total) }}</b> {{ owned ? 'piezas distintas en tu stock' : 'piezas' }}</span>
        <span v-if="f.color" class="chip">{{ meta.colorsById[f.color]?.name }} <button @click="f.color = ''">×</button></span>
      </div>
      <div v-if="!loading && !items.length" class="empty">
        {{ owned ? 'Todavía no tienes piezas. Ve a «Catálogo», pulsa una pieza y añade unidades.' : 'No hay piezas con estos filtros.' }}
      </div>
      <div class="grid">
        <PartCard v-for="d in items" :key="d.design_id" :design="d" :meta="meta" :prefer-color="f.color" @open="selected = d" />
      </div>
      <div ref="sentinel" class="sentinel">
        <BrickSpinner v-if="loading" :size="40" label="" />
        <button v-else-if="!done" class="btn ghost" @click="load(false)">Cargar más</button>
      </div>
    </section>

    <PartModal v-if="selected" :key="selected.design_id" :design="selected" :meta="meta" :prefer-color="f.color"
      @close="selected = null" @updated="onUpdated" />
  </div>
</template>
