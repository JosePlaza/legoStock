// Caché local (SQLite) de respuestas de APIs externas: ahorra llamadas (BrickLink permite 5.000/día).
import { db } from './db.js';

db.exec('CREATE TABLE IF NOT EXISTS api_cache (key TEXT PRIMARY KEY, value TEXT NOT NULL, at INTEGER NOT NULL)');
const get = db.prepare('SELECT value, at FROM api_cache WHERE key = ?');
const put = db.prepare('INSERT OR REPLACE INTO api_cache (key, value, at) VALUES (?, ?, ?)');

export async function cached(key, ttlMs, fn, { force = false } = {}) {
  const hit = get.get(key);
  if (hit && !force && Date.now() - hit.at < ttlMs) return { ...JSON.parse(hit.value), _cachedAt: hit.at };
  const value = await fn();
  put.run(key, JSON.stringify(value), Date.now());
  return { ...value, _cachedAt: Date.now() };
}
export const HOUR = 3600_000;
export const DAY = 24 * HOUR;
