// Conexión con Supabase: configuración desde .env y autenticación de cada petición.
import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
export const SUPABASE_ANON_KEY = (process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || '').trim();
export const configured = /^https?:\/\//.test(SUPABASE_URL) && SUPABASE_ANON_KEY.length > 20;

// La API no usa Realtime, pero supabase-js exige un WebSocket al crear el cliente y Node 20 no lo trae
// de serie. Le pasamos uno "vacío" para que funcione igual en Node 18/20/22.
class NoWebSocket { constructor() { throw new Error('Realtime no se usa en el servidor'); } }

// Cliente que actúa "como el usuario": Supabase aplica las políticas RLS con su token.
export function clientFor(jwt) {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    realtime: { transport: globalThis.WebSocket || NoWebSocket },
  });
}

// Cliente sin usuario, para datos públicos (el catálogo que actualiza el cron de Supabase).
export function anonClient() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    realtime: { transport: globalThis.WebSocket || NoWebSocket },
  });
}

const tokens = new Map(); // jwt -> { user, until }

export async function requireAuth(req, res, next) {
  try {
    if (!configured) {
      return res.status(503).json({ code: 'no_config', error: 'Supabase no está configurado. Rellena SUPABASE_URL y SUPABASE_ANON_KEY en el archivo .env y reinicia.' });
    }
    const h = req.headers.authorization || '';
    const jwt = h.startsWith('Bearer ') ? h.slice(7) : '';
    if (!jwt) return res.status(401).json({ code: 'no_session', error: 'Inicia sesión' });
    const sb = clientFor(jwt);
    let hit = tokens.get(jwt);
    if (!hit || hit.until < Date.now()) {
      const { data, error } = await sb.auth.getUser(jwt);
      if (error || !data?.user) return res.status(401).json({ code: 'bad_session', error: 'La sesión ha caducado, vuelve a entrar' });
      hit = { user: data.user, until: Date.now() + 60_000 };
      tokens.set(jwt, hit);
      if (tokens.size > 500) for (const [k, v] of tokens) if (v.until < Date.now()) tokens.delete(k);
    }
    req.user = hit.user;
    req.sb = sb;
    next();
  } catch (e) { next(e); }
}

// Traduce los errores de Supabase a algo entendible
export function sbError(error) {
  const msg = error?.message || String(error);
  if (error?.code === '42P01' || error?.code === 'PGRST205' || error?.code === 'PGRST202' || /does not exist|schema cache/i.test(msg)) {
    const e = new Error('Faltan las tablas en Supabase. Ejecuta supabase/schema.sql en el SQL Editor de tu proyecto.');
    e.code = 'no_schema';
    return e;
  }
  if (/bucket not found/i.test(msg)) return new Error('Falta el bucket "project-files" en Supabase Storage. Ejecuta supabase/schema.sql.');
  return new Error(msg);
}
export const check = ({ data, error }) => { if (error) throw sbError(error); return data; };
