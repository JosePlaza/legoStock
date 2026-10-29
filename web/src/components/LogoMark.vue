<script setup>
// Logo de LegoStock en SVG. Con `animated`, los tetones caen uno a uno sobre la pieza (spinner de carga).
defineProps({ animated: Boolean });

const BODY = '960.97 147.61 960.97 409.64 768.99 506.22 768.99 768.25 384.49 959.38 0 768.25 0 506.22 384.49 701.75 576.47 600.77 191.98 409.64 191.98 147.61 576.47 346.14 960.97 147.61';
// Un tetón: cilindro de 147 de ancho con la base en (x, y). Ordenados de abajo arriba, que es como caen.
const stud = (x, y) => `M${x},${y + 33.84}c40.72,0,73.72-15.15,73.72-33.84v57.13h-.25c-2.95,17.45-34.71,31.19-73.48,31.19s-70.53-13.74-73.48-31.19h-.25V${y}c0,18.69,33.01,33.84,73.72,33.84Z`;
const STUDS = [[380.96, 551.71], [188.44, 456.97], [576.47, 189.5], [383.96, 94.75], [768.99, 94.75], [576.47, 0]].map(([x, y]) => stud(x, y));
</script>

<template>
  <svg class="logo-mark" :class="{ animated }" viewBox="0 0 960.97 959.38" aria-hidden="true">
    <polygon class="body" :points="BODY" />
    <path v-for="(d, i) in STUDS" :key="i" class="stud" :style="{ '--i': i }" :d="d" />
  </svg>
</template>
