<script setup>
import { ref, onMounted, inject } from 'vue';
import { api } from '../api.js';

const emit = defineEmits(['close', 'saved']);
const notify = inject('notify', () => {});
const s = ref(null);
const busy = ref(false);
onMounted(async () => { s.value = await api.settings(); });
async function save() {
  busy.value = true;
  try { const r = await api.saveSettings(s.value); notify('Ajustes guardados'); emit('saved', r); emit('close'); }
  catch (e) { notify('Error: ' + e.message); }
  finally { busy.value = false; }
}
const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'SEK', 'DKK', 'PLN', 'CAD', 'AUD'];
</script>

<template>
  <div class="overlay" @click.self="$emit('close')">
    <div class="modal wide small-modal">
      <button class="close" @click="$emit('close')">×</button>
      <div class="pad" v-if="s">
        <h2>Ajustes de precios</h2>
        <p class="muted small">Se usan para pedir los precios a BrickLink y estimar el coste real con envío.</p>
        <div class="form-grid">
          <label>País donde recibes (código ISO)<input class="search" v-model="s.country" maxlength="2" placeholder="ES" /></label>
          <label>Divisa<select v-model="s.currency"><option v-for="c in CURRENCIES" :key="c">{{ c }}</option></select></label>
          <label>Envío estimado desde tu país<input class="search" type="number" step="0.5" min="0" v-model="s.ship_domestic" /></label>
          <label>Envío estimado desde la UE<input class="search" type="number" step="0.5" min="0" v-model="s.ship_eu" /></label>
          <label>Envío estimado desde fuera de la UE<input class="search" type="number" step="0.5" min="0" v-model="s.ship_world" /></label>
        </div>
        <p class="small muted">BrickLink no da el envío de cada tienda por API, así que se suma este importe según de dónde sea el vendedor. Pon también aquí una estimación de aduanas si compras fuera de la UE.</p>
        <div class="actions"><button class="btn" :disabled="busy" @click="save">Guardar</button><button class="btn ghost" @click="$emit('close')">Cancelar</button></div>
      </div>
    </div>
  </div>
</template>
