<script setup>
import { ref, computed } from 'vue';
import { sb } from '../supabase.js';
import LogoMark from './LogoMark.vue';

const mode = ref('login');
const email = ref('');
const password = ref('');
const password2 = ref('');
const busy = ref(false);
const error = ref('');
const info = ref('');

const valid = computed(() => /\S+@\S+\.\S+/.test(email.value) && password.value.length >= 6 && (mode.value === 'login' || password.value === password2.value));

const tr = m => {
  if (/invalid login credentials/i.test(m)) return 'Email o contraseña incorrectos.';
  if (/already registered|already exists/i.test(m)) return 'Ya existe una cuenta con ese email. Entra con tu contraseña.';
  if (/email not confirmed/i.test(m)) return 'Tu proyecto de Supabase pide confirmar el email. Desactiva «Confirm email» en Authentication → Sign In / Providers → Email, o confirma desde el correo.';
  if (/password should be at least/i.test(m)) return 'La contraseña tiene que tener al menos 6 caracteres.';
  if (/rate limit/i.test(m)) return 'Demasiados intentos seguidos. Espera un minuto.';
  return m;
};

async function submit() {
  if (!valid.value || busy.value) return;
  busy.value = true; error.value = ''; info.value = '';
  try {
    if (mode.value === 'login') {
      const { error: e } = await sb().auth.signInWithPassword({ email: email.value.trim(), password: password.value });
      if (e) throw e;
    } else {
      const { data, error: e } = await sb().auth.signUp({ email: email.value.trim(), password: password.value });
      if (e) throw e;
      if (!data.session) {
        // El proyecto tiene la confirmación de email activada: intentamos entrar directamente por si acaso
        const r = await sb().auth.signInWithPassword({ email: email.value.trim(), password: password.value });
        if (r.error) info.value = tr('email not confirmed');
      }
    }
  } catch (e) {
    error.value = tr(e.message || String(e));
  } finally {
    busy.value = false;
  }
}
const switchMode = m => { mode.value = m; error.value = ''; info.value = ''; };
</script>

<template>
  <div class="auth-page">
    <div class="auth-card">
      <div class="brand big"><LogoMark />LegoStock</div>
      <p class="muted">Tu stock de piezas LEGO, tus proyectos y listas de Rebrickable.</p>
      <div class="seg full">
        <button :class="{ on: mode === 'login' }" @click="switchMode('login')">Entrar</button>
        <button :class="{ on: mode === 'signup' }" @click="switchMode('signup')">Crear cuenta</button>
      </div>
      <form @submit.prevent="submit" class="auth-form">
        <label class="lbl">Email</label>
        <input class="search" type="email" v-model="email" autocomplete="email" required />
        <label class="lbl">Contraseña</label>
        <input class="search" type="password" v-model="password" :autocomplete="mode === 'login' ? 'current-password' : 'new-password'" minlength="6" required />
        <template v-if="mode === 'signup'">
          <label class="lbl">Repite la contraseña</label>
          <input class="search" type="password" v-model="password2" autocomplete="new-password" minlength="6" required />
          <div v-if="password2 && password !== password2" class="bad-t small">Las contraseñas no coinciden</div>
        </template>
        <div v-if="error" class="banner error small">{{ error }}</div>
        <div v-if="info" class="banner small">{{ info }}</div>
        <button class="btn full" :disabled="!valid || busy" type="submit">
          {{ busy ? 'Un momento…' : mode === 'login' ? 'Entrar' : 'Crear cuenta y entrar' }}
        </button>
      </form>
    </div>
  </div>
</template>
