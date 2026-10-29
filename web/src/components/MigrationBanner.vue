<script setup>
import { ref, onMounted, inject } from 'vue';
import { api, num, fmtDate } from '../api.js';

const emit = defineEmits(['done']);
const notify = inject('notify', () => {});
const st = ref(null);
const running = ref(false);
const report = ref(null);
const error = ref('');
const hidden = ref(false);

onMounted(async () => {
  try { st.value = await api.migrationStatus(); } catch (e) { error.value = e.message; }
});

async function run() {
  running.value = true; error.value = '';
  try {
    report.value = await api.runMigration();
    st.value = await api.migrationStatus();
    if (!report.value.stock.failed) notify(`Importadas ${num(report.value.stock.pieces)} piezas a tu cuenta`);
    emit('done');
  } catch (e) { error.value = e.message; }
  finally { running.value = false; }
}
</script>

<template>
  <div v-if="error && !st" class="banner error">{{ error }}</div>
  <div v-else-if="st && st.hasLocalData && !hidden && (!st.doneForMe || report)" class="banner migrate">
    <template v-if="!report">
      <div>
        <b>Tienes datos guardados en este ordenador de antes de usar cuentas:</b>
        {{ num(st.local.pieces) }} piezas ({{ num(st.local.lots) }} lotes), {{ st.local.projects }} proyectos y {{ st.local.files }} archivos.
        <div class="small muted">
          Impórtalos a tu cuenta para no perderlos. La copia local no se borra y se puede repetir sin duplicar nada.
          <template v-if="st.importedToOther"> Ojo: ya se importaron una vez a otra cuenta.</template>
        </div>
      </div>
      <div class="actions">
        <button class="btn" :disabled="running" @click="run">{{ running ? 'Importando… (no cierres la página)' : 'Importar a mi cuenta' }}</button>
        <button class="btn ghost small" :disabled="running" @click="hidden = true">Ahora no</button>
      </div>
      <div v-if="error" class="bad-t small">{{ error }}</div>
    </template>
    <template v-else>
      <div>
        <b v-if="!report.stock.failed" class="ok-t">✓ Importación completada y comprobada.</b>
        <b v-else class="bad-t">Importación incompleta.</b>
        Stock: {{ num(report.stock.verified) }} de {{ num(report.stock.lots) }} lotes comprobados en la nube ({{ num(report.stock.pieces) }} piezas).
        Proyectos: {{ report.projects }} · archivos: {{ report.files }} · movimientos: {{ num(report.movements) }}.
        <div v-for="w in report.warnings" :key="w" class="small bad-t">{{ w }}</div>
      </div>
      <div class="actions">
        <button v-if="report.stock.failed" class="btn" :disabled="running" @click="run">Reintentar</button>
        <button class="btn ghost small" @click="hidden = true">Cerrar</button>
      </div>
    </template>
  </div>
</template>
