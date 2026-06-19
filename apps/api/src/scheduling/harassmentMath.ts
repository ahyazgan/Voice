// =============================================================================
// scheduling/harassmentMath.ts — KVKK taciz sınırı SAF mantığı (I/O yok)
// =============================================================================
// DB'ye dokunmaz → tam test edilebilir. harassmentGuard.ts (DB'li) bunu kullanır.
// Yerel gün/hafta sınırlarını borçlu timezone'unda hesaplar.
// =============================================================================

import { zonedParts } from './callWindow.js';

export interface HarassmentLimits {
  perDay: number;
  perWeek: number;
  total: number; // 0 = limitsiz
}

/**
 * Sayımları limitlere göre değerlendirir. Hangi limit dolduysa o döner.
 * Öncelik: total > weekly > daily (en kalıcı engel önce).
 */
export function evaluateLimits(
  counts: { today: number; thisWeek: number; total: number },
  limits: HarassmentLimits,
): { allowed: boolean; reason?: 'daily' | 'weekly' | 'total' } {
  if (limits.total > 0 && counts.total >= limits.total) return { allowed: false, reason: 'total' };
  if (limits.perWeek > 0 && counts.thisWeek >= limits.perWeek) return { allowed: false, reason: 'weekly' };
  if (limits.perDay > 0 && counts.today >= limits.perDay) return { allowed: false, reason: 'daily' };
  return { allowed: true };
}

/** Borçlu timezone'unda "bugünün yerel 00:00"ına denk gelen UTC anı. */
export function startOfLocalDay(now: Date, timeZone: string): Date {
  const { isoDate } = zonedParts(now, timeZone);
  return zonedMidnightToUtc(isoDate, timeZone);
}

/** Borçlu timezone'unda "bu haftanın Pazartesi 00:00"ına denk gelen UTC anı (ISO hafta). */
export function startOfLocalWeek(now: Date, timeZone: string): Date {
  const { isoDate, isoWeekday } = zonedParts(now, timeZone);
  const [y, m, d] = isoDate.split('-').map(Number);
  const monday = new Date(Date.UTC(y!, m! - 1, d! - (isoWeekday - 1)));
  const mISO = `${monday.getUTCFullYear()}-${String(monday.getUTCMonth() + 1).padStart(2, '0')}-${String(monday.getUTCDate()).padStart(2, '0')}`;
  return zonedMidnightToUtc(mISO, timeZone);
}

/** "YYYY-MM-DD" yerel gece yarısını UTC Date'e çevirir. */
function zonedMidnightToUtc(isoDate: string, timeZone: string): Date {
  const [y, m, d] = isoDate.split('-').map(Number);
  const guess = new Date(Date.UTC(y!, m! - 1, d!, 0, 0, 0));
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  const parts = dtf.formatToParts(guess);
  const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value ?? '0');
  let hour = get('hour');
  if (hour === 24) hour = 0;
  const asUTC = Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'));
  const offsetMin = Math.round((asUTC - guess.getTime()) / 60_000);
  return new Date(guess.getTime() - offsetMin * 60_000);
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 24 * 60 * 60 * 1000);
}
