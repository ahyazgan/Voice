import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db/index.js';
import { removeCampaignJobs } from '../queue/index.js';
import { scheduleCall } from '../scheduling/scheduler.js';

const CreateCampaignSchema = z.object({
  name: z.string().min(1),
  debtorIds: z.array(z.string()).min(1),
});

export async function campaignsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/campaigns', async () => {
    return prisma.campaign.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { calls: true } } },
    });
  });

  // --- ROI özeti: maliyet vs tahsilat (sonuç-bazlı fiyatlandırmanın temeli) ----
  // Toplam maliyet = Σ CallResult.costTRY. Tahsil edilen = Σ Payment(RECEIVED|PARTIAL).
  // Söz verilen ama gelmeyen (PROMISED/BROKEN) tahsilat sayılmaz — sadece gerçek para.
  app.get('/campaigns/:id/summary', async (req, reply) => {
    const { id } = req.params as { id: string };
    const campaign = await prisma.campaign.findUnique({ where: { id } });
    if (!campaign) {
      reply.code(404);
      return { error: 'not_found' };
    }

    const [byOutcome, costAgg, collectedAgg, promisedAgg] = await Promise.all([
      prisma.call.groupBy({
        by: ['outcome'],
        where: { campaignId: id, outcome: { not: null } },
        _count: true,
      }),
      prisma.callResult.aggregate({
        where: { call: { campaignId: id } },
        _sum: { costTRY: true },
      }),
      prisma.payment.aggregate({
        where: { call: { campaignId: id }, status: { in: ['RECEIVED', 'PARTIAL'] } },
        _sum: { amount: true },
      }),
      prisma.payment.aggregate({
        where: { call: { campaignId: id }, status: { in: ['PROMISED', 'PARTIAL'] } },
        _sum: { amount: true },
      }),
    ]);

    const totalCostKurus = costAgg._sum.costTRY ?? 0;
    const collectedKurus = collectedAgg._sum.amount ?? 0;
    const promisedKurus = promisedAgg._sum.amount ?? 0;

    return {
      campaignId: id,
      outcomes: Object.fromEntries(byOutcome.map((o) => [o.outcome, o._count])),
      // Tümü kuruş (DB int). Panel formatKurus ile gösterir.
      totalCostKurus,
      collectedKurus,
      promisedKurus,
      // Net = tahsil edilen - maliyet. Sonuç-bazlı komisyon bunun üstünden hesaplanır.
      netKurus: collectedKurus - totalCostKurus,
    };
  });

  app.post('/campaigns', async (req, reply) => {
    const body = CreateCampaignSchema.parse(req.body);
    const campaign = await prisma.campaign.create({
      data: {
        name: body.name,
        calls: {
          create: body.debtorIds.map((debtorId) => ({ debtorId, status: 'QUEUED' })),
        },
      },
      include: { calls: { include: { debtor: { select: { timezone: true } } } } },
    });

    // Her aramayı arama-penceresine göre zamanla (pencere dışıysa delayed job).
    for (const call of campaign.calls) {
      await scheduleCall({
        campaignId: campaign.id,
        callId: call.id,
        debtorId: call.debtorId,
        timezone: call.debtor.timezone,
        attempt: 1,
      });
    }

    reply.code(201);
    return campaign;
  });

  // --- Duraklat: bekleyen aramaları kuyruktan çek, RUNNING'ler bitsin ----------
  app.post('/campaigns/:id/pause', async (req, reply) => {
    const { id } = req.params as { id: string };
    const campaign = await prisma.campaign.findUnique({ where: { id } });
    if (!campaign) {
      reply.code(404);
      return { error: 'not_found' };
    }
    if (campaign.status === 'CANCELLED') {
      reply.code(409);
      return { error: 'campaign_cancelled' };
    }

    const removed = await removeCampaignJobs(id);
    // Henüz başlamamış aramalar CANCELLED'a çekilir (resume yeniden enqueue eder).
    // RUNNING'lere dokunma — doğal bitsinler.
    const { count } = await prisma.call.updateMany({
      where: { campaignId: id, status: { in: ['QUEUED', 'SCHEDULED'] } },
      data: { status: 'CANCELLED' },
    });
    await prisma.campaign.update({ where: { id }, data: { status: 'PAUSED' } });

    req.log.info({ campaignId: id, removedJobs: removed, cancelledCalls: count }, 'campaign paused');
    return { ok: true, status: 'PAUSED', removedJobs: removed, pausedCalls: count };
  });

  // --- Devam: duraklatılmış kampanyanın bekleyen aramalarını yeniden kuyruğa al -
  app.post('/campaigns/:id/resume', async (req, reply) => {
    const { id } = req.params as { id: string };
    const campaign = await prisma.campaign.findUnique({ where: { id } });
    if (!campaign) {
      reply.code(404);
      return { error: 'not_found' };
    }
    if (campaign.status !== 'PAUSED') {
      reply.code(409);
      return { error: 'not_paused', status: campaign.status };
    }

    // Duraklatmada CANCELLED'a çekilen ama henüz hiç tamamlanmamış aramaları geri al.
    // (COMPLETED/FAILED/RUNNING'e dokunma — yalnızca duraklatmanın iptal ettikleri.)
    const toResume = await prisma.call.findMany({
      where: { campaignId: id, status: 'CANCELLED' },
      select: { id: true, debtorId: true, debtor: { select: { timezone: true } } },
    });
    await prisma.campaign.update({ where: { id }, data: { status: 'ACTIVE' } });
    // scheduleCall her aramayı pencereye göre yeniden zamanlar (status'u QUEUED/SCHEDULED yapar).
    for (const call of toResume) {
      await scheduleCall({
        campaignId: id,
        callId: call.id,
        debtorId: call.debtorId,
        timezone: call.debtor.timezone,
        attempt: 1,
      });
    }

    req.log.info({ campaignId: id, resumedCalls: toResume.length }, 'campaign resumed');
    return { ok: true, status: 'ACTIVE', resumedCalls: toResume.length };
  });

  // --- İptal: geri dönülmez. Tüm bekleyen aramaları düşür --------------------
  app.post('/campaigns/:id/cancel', async (req, reply) => {
    const { id } = req.params as { id: string };
    const campaign = await prisma.campaign.findUnique({ where: { id } });
    if (!campaign) {
      reply.code(404);
      return { error: 'not_found' };
    }

    const removed = await removeCampaignJobs(id);
    const { count } = await prisma.call.updateMany({
      where: { campaignId: id, status: { in: ['QUEUED', 'SCHEDULED'] } },
      data: { status: 'CANCELLED' },
    });
    await prisma.campaign.update({ where: { id }, data: { status: 'CANCELLED' } });

    req.log.info({ campaignId: id, removedJobs: removed, cancelledCalls: count }, 'campaign cancelled');
    return { ok: true, status: 'CANCELLED', removedJobs: removed, cancelledCalls: count };
  });
}
