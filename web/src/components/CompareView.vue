<script setup>
// Tabla de comparación de una lista Rebrickable con el stock (se usa dentro del detalle de proyecto).
import { ref, computed } from 'vue';
import { img, eur, swatchBg, onImgError } from '../api.js';

const props = defineProps({ result: Object, meta: Object, baseName: String, editableAlt: Boolean });
const emit = defineEmits(['remap', 'toggle-alt', 'set-alt-all', 'open']);
const q = ref('');
const norm = x => String(x ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const onRow = (e, r) => { if (!e.target.closest('button, select, a, input')) emit('open', r); };
const filter = ref('all');

const STATUS = {
  tengo: { label: 'Tengo', cls: 'ok' },
  parcial: { label: 'Parcial', cls: 'warn' },
  falta: { label: 'Falta', cls: 'bad' },
  color_sin_mapear: { label: 'Color sin asignar', cls: 'muted' },
  no_catalogo: { label: 'No está en Pick a Brick', cls: 'muted' },
};
const FILTERS = {
  all: { label: 'Todas', fn: () => true },
  faltan: { label: 'Me faltan', fn: r => r.status === 'falta' || r.status === 'parcial' },
  tengo: { label: 'Las tengo', fn: r => r.status === 'tengo' },
  alt: { label: 'Con alternativa de color', fn: r => r.alt > 0 },
  altno: { label: 'Alternativa descartada', fn: r => r.alt_excluded },
  agotadas: { label: 'Faltan y agotadas', fn: r => r.missing > 0 && (r.available === 'agotado' || r.available === 'retirado') },
  otros: { label: 'Sin identificar', fn: r => r.status === 'color_sin_mapear' || r.status === 'no_catalogo' },
};
const rows = computed(() => {
  const words = norm(q.value).split(/\s+/).filter(Boolean);
  return props.result.rows.filter(FILTERS[filter.value].fn).filter(r => {
    if (!words.length) return true;
    const hay = norm([r.design_name, r.rb_name, r.part, r.design_id, r.element, r.element_id, r.color_name, r.rb_color].join(' '));
    return words.every(w => hay.includes(w));
  });
});
const counts = computed(() => Object.fromEntries(Object.entries(FILTERS).map(([k, x]) => [k, props.result.rows.filter(x.fn).length])));
const color = id => props.meta.colorsById[id];
const altTitle = r => r.alt_colors.map(c => `${c.qty} en ${c.color_name}`).join(' · ');

function exportMissing() {
  const lines = ['Part,Color,Quantity'];
  for (const r of props.result.rows) if (r.missing > 0) lines.push(`${r.part},${r.rb_color},${r.missing}`);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
  a.download = (props.baseName || 'lista') + '-faltan.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}
</script>

<template>
  <div>
    <div v-if="result.unmapped.length" class="banner">
      <b>Colores de Rebrickable sin asignar.</b> Indica a qué color LEGO corresponden (se recuerda para todos los proyectos):
      <div class="unmapped">
        <label v-for="rb in result.unmapped" :key="rb">Color RB <b>{{ rb }}</b> →
          <select @change="emit('remap', rb, $event.target.value)">
            <option value="">elige…</option>
            <option v-for="c in meta.allColors" :key="c.id" :value="c.id">{{ c.name }} ({{ c.id }})</option>
          </select>
        </label>
      </div>
    </div>

    <div class="piece-search">
      <input class="search" v-model="q" type="search" placeholder="Buscar pieza por nombre, nº, ID o color…" />
      <span v-if="q" class="small muted">{{ rows.length }} resultados</span>
    </div>
    <div class="toolbar">
      <div class="seg">
        <button v-for="(x, k) in FILTERS" :key="k" :class="{ on: filter === k }" @click="filter = k">{{ x.label }} <span>{{ counts[k] }}</span></button>
      </div>
      <div class="actions">
        <template v-if="editableAlt">
          <button v-if="result.summary.lines_alt" class="btn ghost small" title="No contar ninguna pieza de otro color en este proyecto" @click="emit('set-alt-all', false)">Descartar todas las alternativas</button>
          <button v-if="result.summary.lines_alt_excluded" class="btn ghost small" @click="emit('set-alt-all', true)">Restaurar alternativas ({{ result.summary.lines_alt_excluded }})</button>
        </template>
        <button class="btn ghost small" :disabled="!result.summary.pieces_missing" @click="exportMissing">⬇ CSV de lo que falta</button>
      </div>
    </div>

    <div class="table-wrap">
      <table class="cmp">
        <thead><tr><th></th><th>Pieza</th><th>Color</th><th class="n">Necesito</th><th class="n">Tengo</th><th class="n">Faltan</th><th>Alternativa</th><th class="n">Precio ud.</th><th>Estado</th></tr></thead>
        <tbody>
          <tr v-for="r in rows" :key="r.part + '|' + r.rb_color" :class="STATUS[r.status].cls" class="clickable" @click="onRow($event, r)">
            <td class="pic"><img :src="r.exact_element || !r.img_url ? img(r.element_id) : r.img_url" loading="lazy" referrerpolicy="no-referrer" @error="onImgError" :class="{ dim: !r.exact_element }" /></td>
            <td class="cell-part">
              <div class="pname">{{ r.design_name || '—' }}</div>
              <div class="muted small">RB {{ r.part }}<template v-if="r.design_id && r.design_id !== r.part"> → ID {{ r.design_id }}</template><template v-else-if="r.design_id"> · ID {{ r.design_id }}</template></div>
            </td>
            <td class="cell-color" data-label="Color">
              <div v-if="r.color_id">
                <span class="dot" :style="{ background: swatchBg(color(r.color_id) || { hex: r.color_hex }) }"></span> {{ r.color_name }}
                <div class="muted small">RB {{ r.rb_color }}</div>
              </div>
              <select v-else class="small" @change="emit('remap', r.rb_color, $event.target.value)">
                <option value="">RB {{ r.rb_color }} → elige color…</option>
                <option v-for="c in meta.allColors" :key="c.id" :value="c.id">{{ c.name }}</option>
              </select>
            </td>
            <td class="n" data-label="Necesito">{{ r.need }}</td>
            <td class="n" data-label="Tengo">{{ r.have }}</td>
            <td class="n" data-label="Faltan"><b v-if="r.missing">{{ r.missing }}</b><span v-else>0</span></td>
            <td data-label="Alternativa">
              <div v-if="r.alt" class="alt" :title="altTitle(r)">
                <span class="alt-chip" :class="{ full: r.alt >= r.missing }">+{{ r.alt }}</span>
                <span v-for="c in r.alt_colors" :key="c.color_id" class="alt-color">
                  <span class="dot" :style="{ background: swatchBg(color(c.color_id) || { hex: c.color_hex }) }"></span>{{ c.qty }}
                </span>
                <div class="muted small">{{ r.alt >= r.missing ? 'cubre lo que falta' : `faltarían ${r.missing - r.alt}` }} en otro color</div>
                <button v-if="editableAlt" class="linkbtn small" title="Es una pieza visible: no quiero sustituirla por otro color" @click="emit('toggle-alt', r.key, false)">✕ No usar otro color</button>
              </div>
              <div v-else-if="r.alt_excluded" class="alt excluded">
                <span class="muted small">Descartada<template v-if="r.alt_possible"> (tienes {{ r.alt_possible }} en otros colores)</template></span>
                <button v-if="editableAlt" class="linkbtn small" @click="emit('toggle-alt', r.key, true)">↺ Usar otro color</button>
              </div>
              <span v-else class="muted">—</span>
            </td>
            <td class="n" data-label="Precio ud.">
              {{ eur(r.price_cents) }}
              <div v-if="r.available === 'agotado'" class="bad-t small">Agotado</div>
              <div v-else-if="r.available === 'retirado'" class="muted small">Retirado</div>
            </td>
            <td class="cell-status"><span class="status" :class="STATUS[r.status].cls">{{ STATUS[r.status].label }}</span></td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
