// =============================================================================
// statsMath.test.ts — /api/stats agregasyon-sonrası türetmeler (saf)
// =============================================================================
import { describe, it, expect } from 'vitest';
import { assembleStats, type RawStats } from '../statsMath.js';

const base: RawStats = {
  statusCounts: {},
  outcomeCounts: {},
  totalCostKurus: 0,
  promiseCount: 0,
  promisedTotalKurus: 0,
  avgResponseMs: null,
  p95ResponseMs: null,
  avgDurationSec: null,
};

describe('assembleStats', () => {
  it('boş veri: oranlar null, toplamlar sıfır', () => {
    const s = assembleStats(base);
    expect(s.totals).toEqual({ calls: 0, completed: 0, failed: 0, reached: 0 });
    expect(s.rates.reachRate).toBeNull();
    expect(s.rates.promiseRate).toBeNull();
    expect(s.cost.perCallTRY).toBeNull();
    expect(s.cost.perPromiseTRY).toBeNull();
    // tüm sonuç anahtarları 0 ile dolu olmalı
    expect(s.outcomes.PROMISE_TO_PAY).toBe(0);
    expect(s.outcomes.NO_ANSWER).toBe(0);
  });

  it('ulaşılan = NO_ANSWER dışı sonuçlar; oranlar doğru', () => {
    const s = assembleStats({
      ...base,
      statusCounts: { COMPLETED: 8, FAILED: 2 }, // 10 arama
      outcomeCounts: { PROMISE_TO_PAY: 3, NO_ANSWER: 4, REFUSED: 1 }, // 8 sonuç, 4 ulaşıldı
      promiseCount: 3,
    });
    expect(s.totals.calls).toBe(10);
    expect(s.totals.completed).toBe(8);
    expect(s.totals.failed).toBe(2);
    expect(s.totals.reached).toBe(4); // 8 - 4 NO_ANSWER
    expect(s.rates.reachRate).toBeCloseTo(4 / 10);
    expect(s.rates.promiseRate).toBeCloseTo(3 / 4);
  });

  it('maliyet: arama ve söz başına yuvarlanır', () => {
    const s = assembleStats({
      ...base,
      statusCounts: { COMPLETED: 3 },
      outcomeCounts: { PROMISE_TO_PAY: 2, NO_ANSWER: 1 }, // 3 sonuç
      promiseCount: 2,
      promisedTotalKurus: 150000,
      totalCostKurus: 1000,
    });
    expect(s.cost.totalTRY).toBe(1000);
    expect(s.cost.perCallTRY).toBe(Math.round(1000 / 3)); // 333
    expect(s.cost.perPromiseTRY).toBe(500); // 1000 / 2
    expect(s.promise).toEqual({ count: 2, totalAmount: 150000 });
  });

  it('kalite metrikleri yuvarlanır, null korunur', () => {
    const s = assembleStats({ ...base, avgResponseMs: 612.7, p95ResponseMs: 980.2, avgDurationSec: 47.5 });
    expect(s.quality.avgResponseMs).toBe(613);
    expect(s.quality.p95ResponseMs).toBe(980);
    expect(s.quality.avgDurationSec).toBe(48);
    const n = assembleStats(base);
    expect(n.quality.avgResponseMs).toBeNull();
  });
});
