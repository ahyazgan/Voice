import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db/index.js';
import { assembleStats, type Outcome } from './statsMath.js';

const Query = z.object({
  // Opsiyonel: tek kampanyaya daralt. Yoksa tüm kampanyalar.
  campaignId: z.string().optional(),
  // Opsiyonel tarih aralığı (Call.createdAt). ISO datetime.
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

/**
 * Genel Bakış metrikleri. Ürün konumlandırması "sonuç bazlı fiyat kârlı mı?"
 * sorusuna burada cevap verir: toplam maliyet vs ödeme sözü tutarı + söz başına
 * maliyet. Para alanları KURUŞ (int) — panel formatKurus ile gösterir.
 * Agregasyon-sonrası türetmeler statsMath.assembleStats'te (birim testli).
 */
export async function statsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/stats', async (req) => {
    const { campaignId, from, to } = Query.parse(req.query);

    // Call üzerinde ortak filtre; CallResult ilişki üzerinden aynı filtreyi alır.
    const callWhere: Prisma.CallWhereInput = {};
    if (campaignId) callWhere.campaignId = campaignId;
    if (from || to) {
      callWhere.createdAt = {};
      if (from) callWhere.createdAt.gte = new Date(from);
      if (to) callWhere.createdAt.lte = new Date(to);
    }
    const resultWhere: Prisma.CallResultWhereInput = { call: callWhere };

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

    const statusCounts: Record<string, number> = {};
    for (const g of statusGroups) statusCounts[g.status] = g._count;

    const outcomeCounts: Partial<Record<Outcome, number>> = {};
    for (const g of outcomeGroups) outcomeCounts[g.outcome as Outcome] = g._count;

    return assembleStats({
      statusCounts,
      outcomeCounts,
      totalCostKurus: costAgg._sum.costTRY ?? 0,
      promiseCount: promiseAgg._count,
      promisedTotalKurus: promiseAgg._sum.promisedAmount ?? 0,
      avgResponseMs: costAgg._avg.avgResponseMs,
      p95ResponseMs: costAgg._avg.p95ResponseMs,
      avgDurationSec: durationAgg._avg.durationSec,
    });
  });
}
