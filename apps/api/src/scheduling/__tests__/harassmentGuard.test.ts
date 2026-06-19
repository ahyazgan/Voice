// =============================================================================
// harassmentGuard.test.ts — KVKK taciz sınırı saf mantığı
// =============================================================================
import { describe, it, expect } from 'vitest';
import {
  evaluateLimits,
  startOfLocalDay,
  startOfLocalWeek,
  type HarassmentLimits,
} from '../harassmentMath.js';

const TZ = 'Europe/Istanbul'; // UTC+3

describe('evaluateLimits', () => {
  const limits: HarassmentLimits = { perDay: 1, perWeek: 3, total: 10 };

  it('hepsi sıfırsa izin verir', () => {
    expect(evaluateLimits({ today: 0, thisWeek: 0, total: 0 }, limits)).toEqual({ allowed: true });
  });

  it('günlük limit doluysa daily reddeder', () => {
    expect(evaluateLimits({ today: 1, thisWeek: 1, total: 1 }, limits)).toEqual({
      allowed: false, reason: 'daily',
    });
  });

  it('haftalık limit günlükten önce değerlendirilir', () => {
    // today=0 (günlük OK) ama thisWeek=3 (haftalık dolu) → weekly
    expect(evaluateLimits({ today: 0, thisWeek: 3, total: 3 }, limits)).toEqual({
      allowed: false, reason: 'weekly',
    });
  });

  it('toplam limit en öncelikli', () => {
    expect(evaluateLimits({ today: 0, thisWeek: 0, total: 10 }, limits)).toEqual({
      allowed: false, reason: 'total',
    });
  });

  it('total=0 → toplam limit kapalı', () => {
    const noTotal: HarassmentLimits = { perDay: 1, perWeek: 3, total: 0 };
    expect(evaluateLimits({ today: 0, thisWeek: 0, total: 9999 }, noTotal)).toEqual({ allowed: true });
  });
});

describe('startOfLocalDay', () => {
  it('İstanbul yerel 00:00 = önceki gün 21:00 UTC', () => {
    // 2026-06-15 10:00 UTC = 13:00 İstanbul → o günün yerel 00:00'ı = 2026-06-14 21:00 UTC
    const start = startOfLocalDay(new Date('2026-06-15T10:00:00Z'), TZ);
    expect(start.toISOString()).toBe('2026-06-14T21:00:00.000Z');
  });

  it('gece yarısından hemen sonra aynı yerel gün', () => {
    // 2026-06-15 00:30 İstanbul = 2026-06-14 21:30 UTC → yerel gün başı 2026-06-14 21:00 UTC
    const start = startOfLocalDay(new Date('2026-06-14T21:30:00Z'), TZ);
    expect(start.toISOString()).toBe('2026-06-14T21:00:00.000Z');
  });
});

describe('startOfLocalWeek', () => {
  it('Pazartesi başlangıçlı hafta — Çarşamba\'dan Pazartesi 00:00\'a döner', () => {
    // 2026-06-17 Çarşamba 12:00 İstanbul (09:00 UTC) → bu hafta Pzt = 2026-06-15 00:00 İst = 2026-06-14 21:00 UTC
    const start = startOfLocalWeek(new Date('2026-06-17T09:00:00Z'), TZ);
    expect(start.toISOString()).toBe('2026-06-14T21:00:00.000Z');
  });

  it('Pazar günü hâlâ o haftaya (önceki Pzt) ait', () => {
    // 2026-06-14 Pazar 12:00 İstanbul (09:00 UTC) → bu hafta Pzt = 2026-06-08 00:00 İst = 2026-06-07 21:00 UTC
    const start = startOfLocalWeek(new Date('2026-06-14T09:00:00Z'), TZ);
    expect(start.toISOString()).toBe('2026-06-07T21:00:00.000Z');
  });
});
