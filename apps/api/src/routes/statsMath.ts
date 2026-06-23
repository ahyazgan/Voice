// /api/stats için saf (DB'siz) agregasyon-sonrası montaj mantığı.
// Prisma sorguları stats.ts'te; oran/maliyet türetmeleri burada — birim test
// edilebilsin diye ayrıldı (bkz. scheduling/harassmentMath.ts kalıbı).

// Tüm olası sonuçlar — dağılımı sıfırla doldurmak için (grafik boşluk göstermesin).
export const ALL_OUTCOMES = [
  'PROMISE_TO_PAY',
  'DISPUTE',
  'WRONG_NUMBER',
  'NO_ANSWER',
  'CALLBACK_REQUESTED',
  'ESCALATED_TO_HUMAN',
  'REFUSED',
] as const;

export type Outcome = (typeof ALL_OUTCOMES)[number];

export interface RawStats {
  /** Call.status → adet. */
  statusCounts: Record<string, number>;
  /** CallResult.outcome → adet (eksik anahtarlar 0 sayılır). */
  outcomeCounts: Partial<Record<Outcome, number>>;
  totalCostKurus: number;
  promiseCount: number;
  promisedTotalKurus: number;
  avgResponseMs: number | null;
  p95ResponseMs: number | null;
  avgDurationSec: number | null;
}

export interface StatsResponse {
  totals: { calls: number; completed: number; failed: number; reached: number };
  rates: { reachRate: number | null; promiseRate: number | null };
  outcomes: Record<Outcome, number>;
  // Tüm para alanları KURUŞ (int) — invariant. Panel formatKurus ile gösterir.
  promise: { count: number; totalAmount: number };
  cost: { totalKurus: number; perCallKurus: number | null; perPromiseKurus: number | null };
  quality: {
    avgDurationSec: number | null;
    avgResponseMs: number | null;
    p95ResponseMs: number | null;
  };
}

const round = (x: number | null): number | null => (x != null ? Math.round(x) : null);

export function assembleStats(raw: RawStats): StatsResponse {
  // Sonuç dağılımını tüm değerlerle (0 dahil) doldur.
  const outcomes = {} as Record<Outcome, number>;
  let resultsTotal = 0;
  for (const o of ALL_OUTCOMES) {
    const n = raw.outcomeCounts[o] ?? 0;
    outcomes[o] = n;
    resultsTotal += n;
  }

  const totalCalls = Object.values(raw.statusCounts).reduce((a, b) => a + b, 0);

  // Ulaşılan (kontak kuruldu): biri açtı — NO_ANSWER dışındaki tüm sonuçlar.
  const reached = resultsTotal - outcomes.NO_ANSWER;

  return {
    totals: {
      calls: totalCalls,
      completed: raw.statusCounts.COMPLETED ?? 0,
      failed: raw.statusCounts.FAILED ?? 0,
      reached,
    },
    rates: {
      reachRate: totalCalls > 0 ? reached / totalCalls : null,
      promiseRate: reached > 0 ? raw.promiseCount / reached : null,
    },
    outcomes,
    promise: {
      count: raw.promiseCount,
      totalAmount: raw.promisedTotalKurus,
    },
    cost: {
      totalKurus: raw.totalCostKurus,
      perCallKurus: resultsTotal > 0 ? Math.round(raw.totalCostKurus / resultsTotal) : null,
      perPromiseKurus: raw.promiseCount > 0 ? Math.round(raw.totalCostKurus / raw.promiseCount) : null,
    },
    quality: {
      avgDurationSec: round(raw.avgDurationSec),
      avgResponseMs: round(raw.avgResponseMs),
      p95ResponseMs: round(raw.p95ResponseMs),
    },
  };
}
