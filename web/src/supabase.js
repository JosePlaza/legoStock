// Cliente de Supabase del navegador. La URL y la clave pública vienen de la API (/api/config),
// que las lee del .env: así solo hay un sitio donde configurarlas.
import { createClient } from '@supabase/supabase-js';

let client = null;
let config = null;

export async function loadConfig() {
  if (config) return config;
  const r = await fetch('/api/config');
  if (!r.ok) throw new Error('No puedo conectar con la API (en local, ¿está arrancado "npm run dev"?)');
  config = await r.json();
  if (config.configured) client = createClient(config.url, config.anonKey, { auth: { persistSession: true, autoRefreshToken: true } });
  return config;
}

export const sb = () => client;

export async function accessToken() {
  if (!client) return null;
  const { data } = await client.auth.getSession();
  return data.session?.access_token || null;
}
