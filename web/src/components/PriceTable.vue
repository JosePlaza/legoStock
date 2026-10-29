<script setup>
// Guía de precios de BrickLink: Nuevo/Usado × (tu país, UE, mundo) + envío estimado + vendidos 6 meses
import { computed } from 'vue';
import { money, SCOPES } from '../api.js';

const props = defineProps({ prices: Object, best: Object, settings: Object, showBest: { type: Boolean, default: true } });
const cur = computed(() => props.prices?.currency || props.settings?.currency || 'EUR');
const ship = computed(() => ({ country: props.settings?.ship_domestic, eu: props.settings?.ship_eu, world: props.settings?.ship_world }));
const COND = { N: 'Nuevo', U: 'Usado' };
const cell = (cond, scope) => props.prices?.guide?.[cond]?.stock?.[scope];
const sold = cond => props.prices?.guide?.[cond]?.sold?.world;
const total = (cond, scope) => { const c = cell(cond, scope); const p = c?.min_ship ?? c?.min; return p == null ? null : p + (ship.value[scope] || 0); };
const isBest = (cond, scope) => props.best?.[cond]?.scope === scope;
</script>

<template>
  <div class="price-table">
    <div v-if="showBest" class="best-row">
      <div v-for="(label, cond) in COND" :key="cond" class="best" :class="{ none: !best?.[cond] }">
        <span class="muted small">{{ label }} · mejor precio con envío</span>
        <b>{{ money(best?.[cond]?.total, cur) }}</b>
        <span v-if="best?.[cond]" class="small muted">{{ money(best[cond].price, cur) }} + {{ money(best[cond].shipping, cur) }} envío · {{ SCOPES[best[cond].scope] }}</span>
        <span v-else class="small muted">Nadie lo vende ahora</span>
      </div>
    </div>
    <div class="table-wrap">
      <table class="cmp prices">
        <thead><tr><th></th><th v-for="(l, s) in SCOPES" :key="s">{{ s === 'country' ? `Vendedores en ${prices?.country || settings?.country}` : l }}<div class="muted small">envío est. {{ money(ship[s], cur) }}</div></th><th>Vendidos 6 meses</th></tr></thead>
        <tbody>
          <tr v-for="(label, cond) in COND" :key="cond">
            <td><b>{{ label }}</b></td>
            <td v-for="(l, s) in SCOPES" :key="s" :class="{ hl: isBest(cond, s) }" :data-label="l">
              <template v-if="cell(cond, s)?.lots">
                <div>desde <b>{{ money(cell(cond, s).min_ship ?? cell(cond, s).min, cur) }}</b></div>
                <div class="small muted">media {{ money(cell(cond, s).avg, cur) }} · {{ cell(cond, s).lots }} lotes</div>
                <div class="small">≈ <b>{{ money(total(cond, s), cur) }}</b> con envío</div>
              </template>
              <span v-else class="muted">—</span>
            </td>
            <td data-label="Vendidos 6 meses">
              <template v-if="sold(cond)?.lots">
                <div>media <b>{{ money(sold(cond).avg, cur) }}</b></div>
                <div class="small muted">{{ money(sold(cond).min, cur) }} – {{ money(sold(cond).max, cur) }} · {{ sold(cond).units ?? sold(cond).lots }} uds</div>
              </template>
              <span v-else class="muted">—</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p class="small muted">Precios de BrickLink en {{ cur }} con IVA de las tiendas que lo aplican. «Desde» es el lote más barato que envía; el envío es una estimación tuya (⚙ Ajustes).</p>
  </div>
</template>
