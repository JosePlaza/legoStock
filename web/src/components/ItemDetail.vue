<script setup>
import { ref, computed, onMounted, onBeforeUnmount, inject, watch } from 'vue';
import { api, money, eur, onImgError } from '../api.js';
import PriceTable from './PriceTable.vue';
import OffersTable from './OffersTable.vue';
import { SCOPES } from '../api.js';
import BrickSpinner from './BrickSpinner.vue';

const props = defineProps({ type: String, no: String });
const emit = defineEmits(['close', 'wish']);
const notify = inject('notify', () => {});
const d = ref(null);
const loading = ref(true);
const color = ref(null);
const adding = ref(false);

async function load(force) {
  loading.value = true;
  try {
    d.value = await api.item(props.type, props.no, { ...(color.value ? { color: color.value } : {}), ...(force ? { force: 1 } : {}) });
    color.value = d.value.color;
  } catch (e) { notify('Error: ' + e.message); }
  finally { loading.value = false; }
}
onMounted(() => load());
watch(color, (n, o) => { if (o != null && n !== o) load(); });

async function addWish() {
  adding.value = true;
  try { const r = await api.addWish({ set_num: d.value.info.no }); notify(`«${r.item.name}» añadido a tu wishlist`); emit('wish', r.item); }
  catch (e) { notify(e.message); }
  finally { adding.value = false; }
}
const selColor = computed(() => d.value?.colors?.find(c => String(c.id) === String(color.value)));
const onKey = e => { if (e.key === 'Escape') emit('close'); };
onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <div class="overlay" @click.self="$emit('close')">
    <div class="modal wide xl">
      <button class="close" @click="$emit('close')">×</button>
      <div class="pad">
        <div v-if="loading && !d" class="loading-block"><BrickSpinner /></div>
        <template v-if="d">
          <div class="item-head">
            <div class="item-img"><img :src="d.info.img" referrerpolicy="no-referrer" @error="onImgError" /></div>
            <div class="item-info">
              <div class="crumbs">{{ d.info.type === 'SET' ? 'Set' : 'Pieza' }} · {{ d.info.no }}<template v-if="d.info.bl_no && d.info.bl_no !== d.info.no"> · BrickLink {{ d.info.bl_no }}</template></div>
              <h2>{{ d.info.name || d.info.no }}</h2>
              <div class="muted small">
                <template v-if="d.info.year">{{ d.info.year }}</template>
                <template v-if="d.info.theme"> · {{ d.info.theme }}</template>
                <template v-if="d.info.num_parts"> · {{ d.info.num_parts }} piezas</template>
              </div>
              <div v-if="d.colors?.length" class="color-pick">
                <label class="lbl">Color ({{ d.colors.length }})</label>
                <select v-model="color">
                  <option v-for="c in d.colors" :key="c.id" :value="c.id">{{ c.name }}{{ c.bl == null ? ' (sin equivalente en BrickLink)' : '' }}</option>
                </select>
                <span v-if="selColor?.rgb" class="dot big" :style="{ background: '#' + selColor.rgb.replace('#', '') }"></span>
              </div>
              <div v-if="d.local" class="local-box small">
                Tienes <b>{{ d.local.total_qty }}</b> de esta pieza (todos los colores).
                <template v-if="d.local.variant"> En este color: <b>{{ d.local.variant.qty }}</b> · Pick a Brick {{ eur(d.local.variant.price_cents) }}{{ d.local.variant.available ? '' : ' (agotado)' }}</template>
                <template v-else> En Pick a Brick desde {{ eur(d.local.min_price) }}.</template>
              </div>
              <div class="actions">
                <button v-if="d.info.type === 'SET'" class="btn" :disabled="adding" @click="addWish">♡ Añadir a wishlist</button>
                <a class="btn ghost small" :href="d.info.bl_url" target="_blank" rel="noopener">Ver en BrickLink ↗</a>
                <button v-if="d.prices || d.brickowl" class="btn ghost small" :disabled="loading" @click="load(true)">{{ loading ? 'Actualizando…' : '↻ Actualizar precios' }}</button>
              </div>
            </div>
          </div>
          <div v-for="w in d.warnings" :key="w" class="banner small error">{{ w }}</div>
          <div v-if="d.best?.N || d.best?.U" class="best-row">
            <div v-for="(label, c) in { N: 'Nuevo', U: 'Usado' }" :key="c" class="best" :class="{ none: !d.best[c] }">
              <span class="muted small">{{ label }} · mejor precio con envío</span>
              <b>{{ money(d.best[c]?.total, d.settings.currency) }}</b>
              <span v-if="d.best[c]" class="small muted">
                {{ money(d.best[c].price, d.settings.currency) }} + {{ money(d.best[c].shipping, d.settings.currency) }} envío ·
                {{ d.best[c].source === 'brickowl' ? `BrickOwl · ${d.best[c].store}` : 'BrickLink' }} · {{ SCOPES[d.best[c].scope] }}
              </span>
              <span v-else class="small muted">Nadie lo vende ahora</span>
              <a v-if="d.best[c]?.url" class="small" :href="d.best[c].url" target="_blank" rel="noopener">Ir a la oferta ↗</a>
            </div>
          </div>
          <template v-if="d.brickowl">
            <h3>Tiendas en BrickOwl <small class="muted">({{ d.brickowl.offers.length }} ofertas que envían a {{ d.settings.country }})</small></h3>
            <div v-if="d.brickowl.note" class="muted small">{{ d.brickowl.note }}</div>
            <OffersTable v-if="!d.brickowl.error" :offers="d.brickowl.offers" :currency="d.settings.currency" :country="d.settings.country" />
          </template>
          <template v-if="d.prices">
            <h3>Guía de precios de BrickLink</h3>
            <PriceTable :prices="d.prices" :best="d.blBest" :settings="d.settings" :show-best="false" />
          </template>
          <div v-if="!d.integrations.brickowl && !d.integrations.bricklink" class="banner small">Configura BrickOwl (<code>BRICKOWL_API_KEY</code>) o BrickLink en <code>.env</code> para ver tiendas y precios.</div>
        </template>
      </div>
    </div>
  </div>
</template>
