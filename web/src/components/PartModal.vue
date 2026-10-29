<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, inject } from 'vue';
import { api, img, eur, swatchBg, pickVariant, onImgError } from '../api.js';

const props = defineProps({ design: Object, meta: Object, preferColor: String });
const emit = defineEmits(['close', 'updated']);
const notify = inject('notify', () => {});

const colorId = ref(pickVariant(props.design, props.preferColor).color_id);
const v = computed(() => props.design.variants.find(x => x.color_id === colorId.value) || props.design.variants[0]);
const color = id => props.meta.colorsById[id];
const qtyInput = ref(v.value?.qty ?? 0);
watch(() => v.value?.qty, q => (qtyInput.value = q ?? 0));
const busy = ref(false);

const cat = computed(() => props.meta.catsById[props.design.category_id]?.name);
const sub = computed(() => props.meta.subsById[props.design.subcategory_id]?.name);

async function change(body) {
  if (busy.value) return;
  busy.value = true;
  try {
    const r = await api.stock({ design_id: props.design.design_id, color_id: colorId.value, ...body });
    emit('updated', r.design);
  } catch (e) {
    notify('Error: ' + e.message);
  } finally {
    busy.value = false;
  }
}
function setQty() {
  const n = Math.max(0, parseInt(qtyInput.value, 10) || 0);
  if (n !== v.value.qty) change({ qty: n });
  else qtyInput.value = n;
}
const onKey = e => { if (e.key === 'Escape') emit('close'); };
onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <div class="overlay" @click.self="$emit('close')">
    <div class="modal" role="dialog" aria-modal="true">
      <button class="close" @click="$emit('close')" aria-label="Cerrar">×</button>
      <div class="modal-img">
        <img :src="img(v?.element_id)" :alt="design.name" referrerpolicy="no-referrer" @error="onImgError" />
      </div>
      <div class="modal-info">
        <div class="crumbs">{{ cat }}<template v-if="sub"> › {{ sub }}</template></div>
        <h2>{{ design.name }}</h2>
        <div class="ids">
          <span>ID: <b>{{ design.design_id }}</b></span>
          <span>Elemento: <b>{{ v?.element_id }}</b></span>
        </div>
        <div class="big-price">
          {{ eur(v?.price_cents) }}
          <span v-if="v && !v.available" class="soldout">{{ v.removed ? 'Ya no está en Pick a Brick' : 'Agotado en LEGO' }}</span>
        </div>

        <h4>Color: <span class="muted">{{ color(colorId)?.name }}</span> <small class="muted">({{ design.variants.length }} disponibles)</small></h4>
        <div class="color-grid">
          <button v-for="x in design.variants" :key="x.color_id" class="sw lg" :class="{ on: x.color_id === colorId }"
            :style="{ background: swatchBg(color(x.color_id)) }" :title="color(x.color_id)?.name" @click="colorId = x.color_id">
            <span v-if="x.qty" class="sw-qty">{{ x.qty }}</span>
          </button>
        </div>

        <div class="stock-box">
          <div class="stock-label">En stock en <b>{{ color(colorId)?.name }}</b></div>
          <div class="stepper">
            <button :disabled="busy || !v?.qty" @click="change({ delta: -1 })" aria-label="Quitar uno">−</button>
            <input type="number" min="0" v-model="qtyInput" @change="setQty" @keyup.enter="$event.target.blur()" />
            <button :disabled="busy" @click="change({ delta: 1 })" aria-label="Añadir uno">+</button>
          </div>
          <div class="quick">
            <button v-for="n in [5, 10, 50]" :key="n" class="btn ghost small" :disabled="busy" @click="change({ delta: n })">+{{ n }}</button>
            <button class="btn ghost small" :disabled="busy || !v?.qty" @click="change({ qty: 0 })">Vaciar</button>
          </div>
          <div class="stock-total">Total de esta pieza en todos los colores: <b>{{ design.total_qty }}</b></div>
        </div>
      </div>
    </div>
  </div>
</template>
