<script setup>
import LogoMark from './LogoMark.vue';

defineProps({ label: { type: String, default: 'Cargando…' }, size: { type: Number, default: 56 } });
</script>

<template>
  <div class="brick-spinner" role="status" :style="{ '--size': size + 'px' }">
    <LogoMark animated />
    <span v-if="label">{{ label }}</span>
  </div>
</template>
