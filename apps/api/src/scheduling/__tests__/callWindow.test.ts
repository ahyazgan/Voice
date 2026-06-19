// =============================================================================
// callWindow.test.ts — arama saati penceresi saf mantığı (timezone-aware)
// =============================================================================
import { describe, it, expect } from 'vitest';
import {
  isWithinWindow,
  nextWindowStart,
  zonedParts,
  parseWindowConfig,
  type CallWindowConfig,
} from '../callWindow.js';

// Pzt–Cmt, 08:00–19:00, tek tatil 2026-04-23 (Ulusal Egemenlik).
const cfg: CallWindowConfig = {
  start: '08:00',
  end: '19:00',
  days: [1, 2, 3, 4, 5, 6],
  holidays: ['2026-04-23'],
};
const TZ = 'Europe/Istanbul'; // UTC+3 (DST yok)

describe('zonedParts', () => {
  it('UTC anını İstanbul yerel saatine (UTC+3) çevirir', () => {
    // 2026-06-15 09:00 UTC = 12:00 İstanbul, Pazartesi.
    const p = zonedParts(new Date('2026-06-15T09:00:00Z'), TZ);
    expect(p.isoDate).toBe('2026-06-15');
    expect(p.minutes).toBe(12 * 60);
    expect(p.isoWeekday).toBe(1); // Pazartesi
  });

  it('gün sınırını timezone\'a göre kaydırır', () => {
    // 2026-06-15 22:30 UTC = 2026-06-16 01:30 İstanbul, Salı.
    const p = zonedParts(new Date('2026-06-15T22:30:00Z'), TZ);
    expect(p.isoDate).toBe('2026-06-16');
    expect(p.isoWeekday).toBe(2);
    expect(p.minutes).toBe(90);
  });
});

describe('isWithinWindow', () => {
  it('pencere içi: Pazartesi 12:00 İstanbul → true', () => {
    expect(isWithinWindow(new Date('2026-06-15T09:00:00Z'), TZ, cfg)).toBe(true);
  });

  it('pencere öncesi: Pazartesi 07:00 İstanbul → false', () => {
    // 04:00 UTC = 07:00 İstanbul
    expect(isWithinWindow(new Date('2026-06-15T04:00:00Z'), TZ, cfg)).toBe(false);
  });

  it('pencere bitişi dahil değil: 19:00 İstanbul → false', () => {
    // 16:00 UTC = 19:00 İstanbul
    expect(isWithinWindow(new Date('2026-06-15T16:00:00Z'), TZ, cfg)).toBe(false);
    // 18:59 İstanbul → true
    expect(isWithinWindow(new Date('2026-06-15T15:59:00Z'), TZ, cfg)).toBe(true);
  });

  it('Pazar yasak: Pazar 12:00 → false', () => {
    // 2026-06-14 Pazar, 09:00 UTC = 12:00 İstanbul
    expect(isWithinWindow(new Date('2026-06-14T09:00:00Z'), TZ, cfg)).toBe(false);
  });

  it('tatil yasak: 2026-04-23 12:00 → false', () => {
    expect(isWithinWindow(new Date('2026-04-23T09:00:00Z'), TZ, cfg)).toBe(false);
  });

  it('farklı timezone: aynı UTC anı Berlin (UTC+2) penceresinde farklı', () => {
    // 2026-06-15 05:30 UTC = 08:30 İstanbul (içeri) ama 07:30 Berlin (dışarı)
    const at = new Date('2026-06-15T05:30:00Z');
    expect(isWithinWindow(at, 'Europe/Istanbul', cfg)).toBe(true);
    expect(isWithinWindow(at, 'Europe/Berlin', cfg)).toBe(false);
  });
});

describe('nextWindowStart', () => {
  it('zaten pencere içindeyse now döner', () => {
    const now = new Date('2026-06-15T09:00:00Z');
    expect(nextWindowStart(now, TZ, cfg).getTime()).toBe(now.getTime());
  });

  it('sabah erken (07:00) → aynı gün 08:00 İstanbul', () => {
    const now = new Date('2026-06-15T04:00:00Z'); // 07:00 İstanbul Pzt
    const next = nextWindowStart(now, TZ, cfg);
    // 08:00 İstanbul = 05:00 UTC
    expect(next.toISOString()).toBe('2026-06-15T05:00:00.000Z');
  });

  it('akşam geç (20:00) → ertesi gün 08:00', () => {
    const now = new Date('2026-06-15T17:00:00Z'); // 20:00 İstanbul Pzt
    const next = nextWindowStart(now, TZ, cfg);
    // ertesi gün (Salı) 08:00 İstanbul = 05:00 UTC
    expect(next.toISOString()).toBe('2026-06-16T05:00:00.000Z');
  });

  it('Cumartesi akşam → Pazar ATLA → Pazartesi 08:00', () => {
    // 2026-06-13 Cumartesi 20:00 İstanbul = 17:00 UTC
    const now = new Date('2026-06-13T17:00:00Z');
    const next = nextWindowStart(now, TZ, cfg);
    // 2026-06-15 Pazartesi 08:00 İstanbul = 05:00 UTC (Pazar atlandı)
    expect(next.toISOString()).toBe('2026-06-15T05:00:00.000Z');
  });

  it('tatil gününü atlar', () => {
    // 2026-04-22 Çarşamba 20:00 İstanbul = 17:00 UTC; ertesi gün 04-23 TATİL → 04-24
    const now = new Date('2026-04-22T17:00:00Z');
    const next = nextWindowStart(now, TZ, cfg);
    // 2026-04-24 Cuma 08:00 İstanbul = 05:00 UTC
    expect(next.toISOString()).toBe('2026-04-24T05:00:00.000Z');
  });
});

describe('parseWindowConfig', () => {
  it('env stringlerini config\'e çevirir', () => {
    const c = parseWindowConfig({
      CALL_WINDOW_START: '09:00',
      CALL_WINDOW_END: '18:00',
      CALL_WINDOW_DAYS: '1,2,3,4,5',
      PUBLIC_HOLIDAYS: '2026-01-01, 2026-04-23',
    });
    expect(c.days).toEqual([1, 2, 3, 4, 5]);
    expect(c.holidays).toEqual(['2026-01-01', '2026-04-23']);
  });

  it('boş tatil listesi → boş dizi', () => {
    const c = parseWindowConfig({
      CALL_WINDOW_START: '08:00', CALL_WINDOW_END: '19:00',
      CALL_WINDOW_DAYS: '1,2,3,4,5,6', PUBLIC_HOLIDAYS: '',
    });
    expect(c.holidays).toEqual([]);
  });
});
