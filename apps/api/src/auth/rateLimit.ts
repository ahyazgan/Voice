// =============================================================================
// auth/rateLimit.ts — minimal in-memory sabit-pencere hız sınırı (bağımlılıksız)
// =============================================================================
// /login brute-force'a karşı IP-bazlı kapı. Tek-örnek/küçük panel için yeterli;
// ölçekte Redis-tabanlı limiter'a geçilebilir.

export interface RateState {
  count: number;
  resetAt: number;
}

/**
 * Sabit pencere sayacı. Pencere içinde `max`'ı AŞAN istekte true (engelle) döner.
 * Süresi dolan kayıt sıfırlanır (kayıt re-access'te geri kazanılır).
 */
export function hitLimit(
  store: Map<string, RateState>,
  key: string,
  now: number,
  max: number,
  windowMs: number,
): boolean {
  const rec = store.get(key);
  if (!rec || now >= rec.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  rec.count += 1;
  return rec.count > max;
}
