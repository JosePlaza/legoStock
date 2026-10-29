<script setup>
import { ref, computed, onMounted, inject } from 'vue';
import { api, money, num, fmtDate, onImgError, SCOPES } from '../api.js';
import ItemDetail from './ItemDetail.vue';
import IntegrationNotice from './IntegrationNotice.vue';
import SettingsModal from './SettingsModal.vue';

const emit = defineEmits(['changed']);
const notify = inject('notify', () => {});
const items = ref(null);
const integrations = ref(null);
const settings = ref(null);
const form = ref({ set_num: '', rrp: '', target_price: '', name: '' });
const adding = ref(false);
const busy = ref({});
const filter = ref('pendiente');
const sort = ref('recent');
const open = ref(null);
const editing = ref(null);
const confirmDel = ref(null);
const showSettings = ref(false);

const loadError = ref('');
async function load() {
  loadError.value = '';
  try {
    const [w, i, s] = await Promise.all([api.wishlist(), api.integrations(), api.settings()]);
    items.value = w; integrations.value = i; settings.value = s;
  } catch (e) {
    loadError.value = 'No he podido cargar la wishlist: ' + e.message;
    if (!items.value) items.value = [];
  }
}
onMounted(load);
const cur = computed(() => settings.value?.currency || 'EUR');

const shown = computed(() => {
  let l = (items.value || []).filter(w => filter.value === 'todos' || w.status === filter.value);
  const bestOf = w => Math.min(w.best?.N?.total ?? Infinity, w.best?.U?.total ?? Infinity);
  if (sort.value === 'pct') l = [...l].sort((a, b) => (b.summary?.pct_alt ?? -1) - (a.summary?.pct_alt ?? -1));
  if (sort.value === 'deal') l = [...l].sort((a, b) => (b.below_target - a.below_target) || (bestOf(a) - bestOf(b)));
  if (sort.value === 'price') l = [...l].sort((a, b) => bestOf(a) - bestOf(b));
  return l;
});
const totals = computed(() => {
  const l = (items.value || []).filter(w => w.status === 'pendiente');
  return {
    n: l.length,
    rrp: l.reduce((s, w) => s + (Number(w.rrp) || 0), 0),
    best: l.reduce((s, w) => s + (Math.min(w.best?.N?.total ?? Infinity, w.best?.U?.total ?? Infinity) < Infinity ? Math.min(w.best?.N?.total ?? Infinity, w.best?.U?.total ?? Infinity) : 0), 0),
    deals: l.filter(w => w.below_target).length,
  };
});

async function add() {
  adding.value = true;
  try {
    const r = await api.addWish(form.value);
    if (r.existed) { if (!items.value.some(x => x.id === r.item.id)) items.value.unshift(r.item); filter.value = 'todos'; notify(`«${r.item.name}» ya estaba en tu wishlist`); }
    else { items.value.unshift(r.item); notify(`«${r.item.name}» añadido` + (r.warnings?.length ? ` (${r.warnings.join(' · ')})` : '')); }
    form.value = { set_num: '', rrp: '', target_price: '', name: '' };
  } catch (e) { notify(e.message); }
  finally { adding.value = false; }
}
const replace = it => { const i = items.value.findIndex(x => x.id === it.id); if (i >= 0) items.value[i] = it; };
async function run(w, key, fn) {
  busy.value = { ...busy.value, [w.id]: key };
  try { await fn(); } catch (e) { notify('Error: ' + e.message); }
  finally { busy.value = { ...busy.value, [w.id]: null }; }
}
const refresh = w => run(w, 'refresh', async () => { const r = await api.refreshWish(w.id); replace(r.item); notify(r.warnings?.length ? r.warnings.join(' · ') : 'Precios actualizados'); });
const save = (w, fields) => run(w, 'save', async () => { replace(await api.updateWish(w.id, fields)); editing.value = null; });
const toggleBought = w => save(w, { status: w.status === 'comprado' ? 'pendiente' : 'comprado' });
const toProject = w => run(w, 'project', async () => { const p = await api.wishToProject(w.id); notify('Proyecto creado'); location.hash = '#/proyectos/' + p.id; });
const remove = w => run(w, 'del', async () => { await api.deleteWish(w.id); items.value = items.value.filter(x => x.id !== w.id); confirmDel.value = null; });
const startEdit = w => { editing.value = { id: w.id, rrp: w.rrp ?? '', target_price: w.target_price ?? '', notes: w.notes || '', name: w.name }; };
const vsRrp = w => { const b = Math.min(w.best?.N?.total ?? Infinity); return w.rrp && b < Infinity ? Math.round((b / w.rrp - 1) * 100) : null; };
</script>

<template>
  <div class="wishlist">
    <div class="page-head">
      <h1>Wishlist</h1>
      <div class="actions">
        <select v-model="sort" class="auto">
          <option value="recent">Más recientes</option>
          <option value="deal">Mejores ofertas</option>
          <option value="price">Más baratos</option>
          <option value="pct">Más piezas que ya tengo</option>
        </select>
        <button class="btn ghost small" @click="showSettings = true">⚙ Envío y divisa</button>
      </div>
    </div>
    <IntegrationNotice :integrations="integrations" />
    <div v-if="loadError" class="banner error">{{ loadError }} <button class="btn ghost small" @click="load">Reintentar</button></div>

    <form class="wish-add" @submit.prevent="add">
      <label>Nº de set<input class="search" v-model="form.set_num" placeholder="75192 o 10294-1" required /></label>
      <label v-if="integrations && !integrations.rebrickable && !integrations.bricklink">Nombre<input class="search" v-model="form.name" placeholder="Nombre del set" /></label>
      <label>PVP ({{ cur }})<input class="search" type="number" step="0.01" min="0" v-model="form.rrp" placeholder="opcional" /></label>
      <label>Quiero pagar como mucho<input class="search" type="number" step="0.01" min="0" v-model="form.target_price" placeholder="opcional" /></label>
      <button class="btn" :disabled="adding || !form.set_num.trim()">{{ adding ? 'Buscando datos…' : '+ Añadir' }}</button>
    </form>

    <div v-if="items?.length" class="wish-summary">
      <div class="seg">
        <button :class="{ on: filter === 'pendiente' }" @click="filter = 'pendiente'">Pendientes <span>{{ items.filter(w => w.status === 'pendiente').length }}</span></button>
        <button :class="{ on: filter === 'comprado' }" @click="filter = 'comprado'">Comprados <span>{{ items.filter(w => w.status === 'comprado').length }}</span></button>
        <button :class="{ on: filter === 'todos' }" @click="filter = 'todos'">Todos <span>{{ items.length }}</span></button>
      </div>
      <span class="small muted">Pendientes: PVP total <b>{{ money(totals.rrp, cur) }}</b> · mejor precio total en BrickLink <b>{{ money(totals.best, cur) }}</b>
        <template v-if="totals.deals"> · <b class="ok-t">{{ totals.deals }} por debajo de tu objetivo</b></template></span>
    </div>
    <div v-if="items && !items.length" class="empty">Tu wishlist está vacía. Añade un set con su número o desde «Buscar».</div>

    <div class="wgrid">
      <article v-for="w in shown" :key="w.id" class="wcard" :class="{ deal: w.below_target, bought: w.status === 'comprado' }">
        <div v-if="w.below_target" class="deal-badge">¡Por debajo de tu objetivo!</div>
        <div class="wthumb" @click="open = w"><img :src="w.img_url" loading="lazy" referrerpolicy="no-referrer" @error="onImgError" /></div>
        <div class="wbody">
          <div class="crumbs">{{ w.set_num }}<template v-if="w.theme"> · {{ w.theme }}</template><template v-if="w.year"> · {{ w.year }}</template><template v-if="w.num_parts"> · {{ num(w.num_parts) }} pzs</template></div>
          <div class="ptitle">{{ w.name }}</div>

          <template v-if="editing?.id === w.id">
            <div class="form-grid tight">
              <label>PVP<input class="search" type="number" step="0.01" v-model="editing.rrp" /></label>
              <label>Objetivo<input class="search" type="number" step="0.01" v-model="editing.target_price" /></label>
              <label class="span2">Notas<input class="search" v-model="editing.notes" /></label>
            </div>
            <div class="actions"><button class="btn small" @click="save(w, editing)">Guardar</button><button class="btn ghost small" @click="editing = null">Cancelar</button></div>
          </template>
          <template v-else>
            <div class="wprices">
              <div><span class="muted small">PVP</span><b>{{ money(w.rrp, cur) }}</b></div>
              <div><span class="muted small">Objetivo</span><b>{{ money(w.target_price, cur) }}</b></div>
              <div :title="w.best?.N ? `${money(w.best.N.price, cur)} + ${money(w.best.N.shipping, cur)} envío · ${SCOPES[w.best.N.scope]}${w.best.N.store ? ' · ' + w.best.N.store : ''}` : ''">
                <span class="muted small">Nuevo + envío <template v-if="w.best?.N">· {{ w.best.N.source === 'brickowl' ? 'BrickOwl' : 'BrickLink' }}</template></span><b>{{ money(w.best?.N?.total, cur) }}</b>
                <span v-if="vsRrp(w) != null" class="small" :class="vsRrp(w) <= 0 ? 'ok-t' : 'bad-t'">{{ vsRrp(w) > 0 ? '+' : '' }}{{ vsRrp(w) }}% vs PVP</span>
              </div>
              <div :title="w.best?.U ? `${money(w.best.U.price, cur)} + ${money(w.best.U.shipping, cur)} envío · ${SCOPES[w.best.U.scope]}${w.best.U.store ? ' · ' + w.best.U.store : ''}` : ''">
                <span class="muted small">Usado + envío <template v-if="w.best?.U">· {{ w.best.U.source === 'brickowl' ? 'BrickOwl' : 'BrickLink' }}</template></span><b>{{ money(w.best?.U?.total, cur) }}</b>
              </div>
            </div>
            <div v-if="w.summary" class="wpct">
              <div class="pct-row">
                <div class="bar dual"><i :style="{ width: w.summary.pct + '%' }"></i><i class="alt" :style="{ width: (w.summary.pct_alt - w.summary.pct) + '%' }"></i></div>
                <b>{{ w.summary.pct }}%</b>
              </div>
              <div class="small muted">de las piezas ya las tienes<template v-if="w.summary.pieces_alt"> · {{ w.summary.pct_alt }}% con otros colores</template> · faltan {{ num(w.summary.pieces_missing) }} ({{ money(w.summary.missing_value_cents / 100, 'EUR') }} en Pick a Brick)</div>
            </div>
            <div v-else class="small muted">{{ w.has_inventory ? '' : 'Sin inventario (hace falta Rebrickable) para calcular el % que tienes.' }}</div>
            <div v-if="w.notes" class="small notes">📝 {{ w.notes }}</div>
            <div class="small muted" v-if="w.prices_at">Precios del {{ fmtDate(w.prices_at) }}<template v-if="w.prices?.brickowl"> · {{ w.prices.brickowl.count }} ofertas en BrickOwl</template></div>
          </template>

          <div class="actions wactions">
            <button class="btn ghost small" @click="open = w">Precios</button>
            <button class="btn ghost small" :disabled="!!busy[w.id]" @click="refresh(w)">{{ busy[w.id] === 'refresh' ? '…' : '↻' }}</button>
            <a v-if="w.project_id" class="btn ghost small" :href="'#/proyectos/' + w.project_id">Ver proyecto</a>
            <button v-else-if="w.has_inventory" class="btn ghost small" :disabled="!!busy[w.id]" @click="toProject(w)">→ Proyecto</button>
            <button class="btn ghost small" @click="startEdit(w)">Editar</button>
            <button class="btn ghost small" @click="toggleBought(w)">{{ w.status === 'comprado' ? '↩ Pendiente' : '✓ Comprado' }}</button>
            <template v-if="confirmDel !== w.id"><button class="btn ghost small danger" @click="confirmDel = w.id">✕</button></template>
            <template v-else><button class="btn small danger-bg" @click="remove(w)">Quitar</button><button class="btn ghost small" @click="confirmDel = null">No</button></template>
          </div>
        </div>
      </article>
    </div>
    <ItemDetail v-if="open" type="SET" :no="open.set_num" @close="open = null" />
    <SettingsModal v-if="showSettings" @close="showSettings = false" @saved="load" />
  </div>
</template>
