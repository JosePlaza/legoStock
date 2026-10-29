<script setup>
// Ficha de una pieza de un proyecto: imagen grande, datos, tu stock por colores y precios
import { ref, computed, onMounted, onBeforeUnmount, inject } from 'vue';
import { api, img, eur, money, swatchBg, onImgError } from '../api.js';

const props = defineProps({ row: Object, meta: Object });
const emit = defineEmits(['close', 'changed']);
const notify = inject('notify', () => {});
const r = computed(() => props.row);
const design = ref(null);
const item = ref(null);
const busy = ref(false);
const color = id => props.meta.colorsById[id];

const STATUS = { tengo: 'Lo tengo', parcial: 'Tengo una parte', falta: 'Me falta', color_sin_mapear: 'Color sin asignar', no_catalogo: 'No está en Pick a Brick' };

async function load() {
  const jobs = [];
  if (r.value.design_id) jobs.push(api.design(r.value.design_id).then(d => (design.value = d)).catch(() => {}));
  jobs.push(api.item('PART', r.value.part, /^\d+$/.test(r.value.rb_color) ? { color: r.value.rb_color } : {}).then(d => (item.value = d)).catch(() => {}));
  await Promise.all(jobs);
}
onMounted(load);

const bigImg = computed(() => item.value?.info?.img || (r.value.exact_element || !r.value.img_url ? img(r.value.element_id) : r.value.img_url));
const variant = computed(() => design.value?.variants.find(v => v.color_id === r.value.color_id));
const others = computed(() => (design.value?.variants || []).filter(v => v.qty > 0 && v.color_id !== r.value.color_id));

async function change(delta) {
  if (!r.value.design_id || !r.value.color_id) return;
  busy.value = true;
  try {
    const res = await api.stock({ design_id: r.value.design_id, color_id: r.value.color_id, delta });
    design.value = res.design;
    emit('changed');
  } catch (e) { notify('Error: ' + e.message); }
  finally { busy.value = false; }
}
const rbUrl = computed(() => `https://rebrickable.com/parts/${encodeURIComponent(r.value.part)}/`);
const best = computed(() => item.value?.best);
const onKey = e => { if (e.key === 'Escape') emit('close'); };
onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <div class="overlay" @click.self="$emit('close')">
    <div class="modal piece-modal">
      <button class="close" @click="$emit('close')" aria-label="Cerrar">×</button>
      <div class="modal-img"><img :src="bigImg" :alt="r.design_name" referrerpolicy="no-referrer" @error="onImgError" /></div>
      <div class="modal-info">
        <div class="crumbs">{{ STATUS[r.status] }}</div>
        <h2>{{ r.design_name || item?.info?.name || r.part }}</h2>
        <div class="ids">
          <span>Rebrickable: <b>{{ r.part }}</b></span>
          <span v-if="r.design_id">ID LEGO: <b>{{ r.design_id }}</b></span>
          <span v-if="r.element_id">Elemento: <b>{{ r.element_id }}</b></span>
        </div>
        <div class="piece-color">
          <span class="dot big" :style="{ background: swatchBg(color(r.color_id) || { hex: r.color_hex }) }"></span>
          <b>{{ r.color_name || 'Color sin asignar' }}</b> <span class="muted small">(Rebrickable {{ r.rb_color }})</span>
        </div>

        <div class="piece-kpis">
          <div><span>Necesito</span><b>{{ r.need }}</b></div>
          <div class="ok"><span>Tengo</span><b>{{ r.have }}</b></div>
          <div :class="{ bad: r.missing }"><span>Faltan</span><b>{{ r.missing }}</b></div>
          <div v-if="r.alt"><span>Con otro color</span><b class="ok-t">+{{ r.alt }}</b></div>
        </div>

        <div v-if="r.design_id && r.color_id" class="stock-box">
          <div class="stock-label">Tu stock en <b>{{ r.color_name }}</b>: <b>{{ variant?.qty ?? r.have }}</b></div>
          <div class="quick">
            <button class="btn ghost small" :disabled="busy || !(variant?.qty ?? r.have)" @click="change(-1)">−1</button>
            <button class="btn ghost small" :disabled="busy" @click="change(1)">+1</button>
            <button v-if="r.missing" class="btn small" :disabled="busy" @click="change(r.missing)">+{{ r.missing }} (lo que falta)</button>
          </div>
          <div v-if="others.length" class="small muted others">
            También tienes:
            <span v-for="v in others" :key="v.color_id" class="alt-color"><span class="dot" :style="{ background: swatchBg(color(v.color_id)) }"></span>{{ v.qty }} {{ color(v.color_id)?.name }}</span>
          </div>
        </div>
        <div v-else-if="r.status === 'no_catalogo'" class="banner small">
          Esta pieza no está en el catálogo de Pick a Brick, así que no se puede llevar su stock aquí.
        </div>

        <div class="piece-prices">
          <div v-if="r.price_cents != null"><span class="muted small">Pick a Brick</span><b>{{ eur(r.price_cents) }}</b>
            <span v-if="r.available === 'agotado'" class="bad-t small">Agotado</span><span v-else-if="r.available === 'retirado'" class="muted small">Retirado</span></div>
          <div v-if="best?.N"><span class="muted small">Nuevo + envío ({{ best.N.source === 'brickowl' ? 'BrickOwl' : 'BrickLink' }})</span><b>{{ money(best.N.total, item.settings.currency) }}</b></div>
          <div v-if="best?.U"><span class="muted small">Usado + envío</span><b>{{ money(best.U.total, item.settings.currency) }}</b></div>
        </div>

        <div class="actions">
          <a class="btn ghost small" :href="rbUrl" target="_blank" rel="noopener">Rebrickable ↗</a>
          <a v-if="item?.info?.bl_url" class="btn ghost small" :href="item.info.bl_url" target="_blank" rel="noopener">BrickLink ↗</a>
        </div>
      </div>
    </div>
  </div>
</template>
