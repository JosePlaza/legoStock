<script setup>
import { computed } from 'vue';
import { img, eur, swatchBg, pickVariant, onImgError } from '../api.js';

const props = defineProps({ design: Object, meta: Object, preferColor: String });
defineEmits(['open']);
const MAX_DOTS = 8;
const v = computed(() => pickVariant(props.design, props.preferColor));
const dots = computed(() => props.design.variants.slice(0, MAX_DOTS));
const more = computed(() => Math.max(0, props.design.variants.length - MAX_DOTS));
const color = id => props.meta.colorsById[id];
</script>

<template>
  <article class="card" :class="{ owned: design.total_qty > 0 }" @click="$emit('open')" tabindex="0" @keyup.enter="$emit('open')">
    <div v-if="design.total_qty > 0" class="qty-badge" :title="`${design.total_qty} en stock (todos los colores)`">{{ design.total_qty }}</div>
    <div class="thumb">
      <img :src="img(v.element_id)" :alt="design.name" loading="lazy" referrerpolicy="no-referrer" @error="onImgError" />
    </div>
    <div class="card-body">
      <div class="name" :title="design.name">{{ design.name }}</div>
      <div class="id">ID: {{ design.design_id }}</div>
      <div class="dots">
        <span v-for="x in dots" :key="x.color_id" class="dot" :class="{ has: x.qty > 0, sel: x.color_id === v.color_id }"
          :style="{ background: swatchBg(color(x.color_id)) }" :title="`${color(x.color_id)?.name}${x.qty ? ' · ' + x.qty + ' en stock' : ''}`"></span>
        <span v-if="more" class="more">+{{ more }}</span>
      </div>
      <div class="card-foot">
        <span class="price">{{ eur(v.price_cents) }}</span>
        <span v-if="!v.available" class="soldout">{{ v.removed ? 'Retirado' : 'Agotado' }}</span>
      </div>
    </div>
  </article>
</template>
