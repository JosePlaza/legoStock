<script setup>
// Lista de tiendas (BrickOwl) que venden el artículo, ordenadas por precio + envío estimado
import { ref, computed } from 'vue';
import { money, SCOPES } from '../api.js';

const props = defineProps({ offers: Array, currency: String, country: String });
const cond = ref('all');
const scope = ref('all');
const LIMIT = 30;
const showAll = ref(false);
const flag = c => (c && c.length === 2 ? String.fromCodePoint(...[...c.toUpperCase()].map(x => 127397 + x.charCodeAt(0))) : '');
const list = computed(() => (props.offers || []).filter(o =>
  (cond.value === 'all' || o.cond === cond.value) &&
  (scope.value === 'all' || (scope.value === 'eu' ? o.scope !== 'world' : o.scope === scope.value))));
const shown = computed(() => (showAll.value ? list.value : list.value.slice(0, LIMIT)));
const count = c => (props.offers || []).filter(o => c === 'all' || o.cond === c).length;
</script>

<template>
  <div class="offers">
    <div class="toolbar">
      <div class="seg">
        <button :class="{ on: cond === 'all' }" @click="cond = 'all'">Todos <span>{{ count('all') }}</span></button>
        <button :class="{ on: cond === 'N' }" @click="cond = 'N'">Nuevo <span>{{ count('N') }}</span></button>
        <button :class="{ on: cond === 'U' }" @click="cond = 'U'">Usado <span>{{ count('U') }}</span></button>
      </div>
      <select v-model="scope" class="auto">
        <option value="all">Vendedores de cualquier país</option>
        <option value="country">Solo de {{ country }}</option>
        <option value="eu">{{ country }} + Unión Europea</option>
      </select>
    </div>
    <div v-if="!list.length" class="muted pad-y">Ninguna tienda lo vende con estos filtros.</div>
    <div v-else class="table-wrap">
      <table class="cmp offers-t">
        <thead><tr><th>Tienda</th><th>Estado</th><th class="n">Uds</th><th class="n">Precio</th><th class="n">Envío est.</th><th class="n">Total</th><th></th></tr></thead>
        <tbody>
          <tr v-for="(o, i) in shown" :key="o.url || i" :class="{ top: i === 0 }">
            <td class="cell-part">
              <div class="pname">{{ flag(o.country) }} {{ o.store }}</div>
              <div class="muted small">{{ SCOPES[o.scope] }} · {{ o.feedback }} valoraciones<template v-if="o.min_order"> · pedido mín. {{ money(o.min_order, o.currency_orig) }}</template></div>
            </td>
            <td data-label="Estado"><span class="status" :class="o.cond === 'N' ? 'ok' : 'warn'">{{ o.cond_label }}</span></td>
            <td class="n" data-label="Uds">{{ o.qty }}</td>
            <td class="n" data-label="Precio">
              {{ money(o.price, currency) }}
              <div v-if="o.currency_orig && o.currency_orig !== currency" class="muted small">{{ money(o.price_orig, o.currency_orig) }}</div>
            </td>
            <td class="n" data-label="Envío est.">{{ money(o.shipping, currency) }}</td>
            <td class="n" data-label="Total"><b>{{ money(o.total, currency) }}</b></td>
            <td class="cell-status"><a class="btn ghost small" :href="o.url" target="_blank" rel="noopener">Ver ↗</a></td>
          </tr>
        </tbody>
      </table>
    </div>
    <button v-if="list.length > LIMIT && !showAll" class="btn ghost small" @click="showAll = true">Ver las {{ list.length }} ofertas</button>
    <p class="small muted">Precios de BrickOwl convertidos a {{ currency }} con el cambio del BCE. El envío es tu estimación según el país de la tienda (⚙ Ajustes); el real lo ves al pagar en cada tienda.</p>
  </div>
</template>
