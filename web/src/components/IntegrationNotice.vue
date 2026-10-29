<script setup>
defineProps({ integrations: Object });
</script>
<template>
  <div v-if="integrations && (!integrations.rebrickable || (!integrations.brickowl && !integrations.bricklink))" class="banner small setup">
    <div v-if="!integrations.rebrickable">
      <b>Búsqueda por nombre e inventarios:</b> falta la clave de <b>Rebrickable</b> (gratis).
      Entra en rebrickable.com → tu perfil → <i>Settings</i> → pestaña <i>API</i> → <i>Generate new API key</i>
      y pégala en <code>.env</code> como <code>REBRICKABLE_API_KEY</code>.
    </div>
    <div v-if="!integrations.brickowl">
      <b>Tiendas que lo venden:</b> falta la clave de <b>BrickOwl</b>. En brickowl.com → <i>My Account</i> → <i>API Keys</i> crea una
      y pégala en <code>.env</code> como <code>BRICKOWL_API_KEY</code>. Para ver las tiendas, BrickOwl tiene que aprobar la clave para el catálogo
      («catalog approval»): pídelo desde su formulario de contacto.
    </div>
    <div v-if="!integrations.bricklink" class="muted">
      <b>BrickLink (opcional, cuando te den acceso):</b>
      Con tu cuenta iniciada abre <code>bricklink.com/v2/api/register_consumer.page</code> (o My BrickLink → Settings → API),
      acepta las condiciones y pulsa <i>Register</i> para el <i>Consumer Key/Secret</i>; después en <i>Access Tokens</i>
      crea uno con IP <code>0.0.0.0</code>. Copia las 4 claves al <code>.env</code> (<code>BRICKLINK_…</code>).
      BrickLink solo da acceso a la API a miembros registrados y, a veces, lo limita a cuentas con tienda.
    </div>
    <div class="muted">Después reinicia <code>npm run dev</code>.</div>
  </div>
</template>
