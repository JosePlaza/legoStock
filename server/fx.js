// Tipos de cambio del BCE (frankfurter.app, sin clave). Se guardan 12 h.
import { cached, HOUR } from './api-cache.js';

export async function rates(base = 'EUR') {
  return cached(`fx:${base}`, 12 * HOUR, async () => {
    const urls = process.env.FX_API_BASE ? [`${process.env.FX_API_BASE}/latest?from=${base}`] : [`https://api.frankfurter.app/latest?from=${base}`, `https://api.frankfurter.dev/v1/latest?base=${base}`];
    for (const url of urls) {
      try {
        const r = await fetch(url);
        if (r.ok) { const j = await r.json(); return { base, date: j.date, rates: { ...j.rates, [base]: 1 } }; }
      } catch { /* probamos el siguiente */ }
    }
    throw new Error('No he podido obtener los tipos de cambio');
  });
}

// Convierte un importe de `from` a la divisa base de la tabla de cambios (null si no se sabe)
export function convert(amount, from, fx) {
  if (amount == null || !from) return null;
  if (from === fx.base) return amount;
  const r = fx.rates[from];
  return r ? Math.round((amount / r) * 100) / 100 : null;
}
