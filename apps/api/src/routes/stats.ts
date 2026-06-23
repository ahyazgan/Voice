import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db/index.js';

// Tüm olası sonuçlar — dağılımı sıfırla doldurmak için (grafik/tablo boşluk göstermesin).
const ALL_OUTCOMES = [
  'PROMISE_TO_PAY',
  'DISPUTE',
  'WRONG_NUMBER',
  'NO_ANSWER',
  'CALLBACK_REQUESTED',
  'ESCALATED_TO_HUMAN',
  'REFUSED',
] as const;

const Query = z.object({
  // Opsiyonel: tek kampanyaya daralt. Yoksa tüm zaman/tüm kampanya.
  campaignId: z.string().optional(),
});

/**
 * Genel Bakış metrikleri. Ürün konumlandırması "sonuç bazlı fiyat kârlı mı?"
 * sorusuna burada cevap verir: toplam maliyet vs ödeme sözü tutarı + söz başına
 * maliyet. Para alanları KURUŞ (int) — panel formatKurus ile gösterir.
 */
export async function statsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/stats', async (req) => {
    const { campaignId } = Query.parse(req.query);
    const callWhere = campaignId ? { campaignId } : {};
    const resultWhere = campaignId ? { call: { campaignId } } : {};

    const [statusGroups, outcomeGroups, costAgg, durationAgg, promiseAgg] = await Promise.all([
      prisma.call.groupBy({ by: ['status'], _count: true, where: callWhere }),
      prisma.callResult.groupBy({ by: ['outcome'], _count: true, where: resultWhere }),
      prisma.callResult.aggregate({
        _sum: { costTRY: true },
        _avg: { avgResponseMs: true, p95ResponseMs: true },
        where: resultWhere,
      }),
      prisma.call.aggregate({
        _avg: { durationSec: true },
        where: { ...callWhere, status: 'COMPLETED' },
      }),
      prisma.callResult.aggregate({
        _sum: { promisedAmount: true },
        _count: true,
        where: { ...resultWhere, outcome: 'PROMISE_TO_PAY' },
      }),
    ]);

    let totalCalls = 0;
    const statusCounts: Record<string, number> = {};
    for (const g of statusGroups) {
      statusCounts[g.status] = g._count;
      totalCalls += g._count;
    }

    const outcomes: Record<string, number> = {};
    for (const o of ALL_OUTCOMES) outcomes[o] = 0;
    let resultsTotal = 0;
    for (const g of outcomeGroups) {
      outcomes[g.outcome] = g._count;
      resultsTotal += g._count;
    }

    // Ulaşılan (kontak kuruldu): biri açtı — NO_ANSWER dışındaki tüm sonuçlar.
    const reached = resultsTotal - (outcomes.NO_ANSWER ?? 0);

    const promiseCount = promiseAgg._count;
    const promisedTotal = promiseAgg._sum.promisedAmount ?? 0; // kuruş
    const totalCost = costAgg._sum.costTRY ?? 0; // kuruş

    return {
      totals: {
        calls: totalCalls,
        completed: statusCounts.COMPLETED ?? 0,
        failed: statusCounts.FAILED ?? 0,
        reached,
      },
      rates: {
        reachRate: totalCalls > 0 ? reached / totalCalls : null,
        promiseRate: reached > 0 ? promiseCount / reached : null,
      },
      outcomes,
      promise: {
        count: promiseCount,
        totalAmount: promisedTotal, // kuruş
      },
      cost: {
        totalTRY: totalCost, // kuruş
        perCallTRY: resultsTotal > 0 ? Math.round(totalCost / resultsTotal) : null,
        perPromiseTRY: promiseCount > 0 ? Math.round(totalCost / promiseCount) : null,
      },
      quality: {
        avgDurationSec:
          durationAgg._avg.durationSec != null ? Math.round(durationAgg._avg.durationSec) : null,
        avgResponseMs:
          costAgg._avg.avgResponseMs != null ? Math.round(costAgg._avg.avgResponseMs) : null,
        p95ResponseMs:
          costAgg._avg.p95ResponseMs != null ? Math.round(costAgg._avg.p95ResponseMs) : null,
      },
    };
  });
}
