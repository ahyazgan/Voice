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
    const [campaigns, outcomeGroups] = await Promise.all([
      prisma.campaign.findMany({
        orderBy: { createdAt: 'desc' },
        include: { _count: { select: { calls: true } } },
      }),
      // Call.outcome denormalize alanı: huni metriklerini CallResult join'i
      // olmadan tek groupBy ile kampanya başına derler (maliyet için dashboard
      // kampanya filtresine bak).
      prisma.call.groupBy({
        by: ['campaignId', 'outcome'],
        _count: true,
        where: { outcome: { not: null } },
      }),
    ]);

    const metrics = new Map<string, { reached: number; promises: number }>();
    for (const g of outcomeGroups) {
      const m = metrics.get(g.campaignId) ?? { reached: 0, promises: 0 };
      // Ulaşılan (kontak): NO_ANSWER dışı tüm sonuçlandırılmış aramalar.
      if (g.outcome !== 'NO_ANSWER') m.reached += g._count;
      if (g.outcome === 'PROMISE_TO_PAY') m.promises += g._count;
      metrics.set(g.campaignId, m);
    }

    return campaigns.map((c) => ({
      ...c,
      metrics: metrics.get(c.id) ?? { reached: 0, promises: 0 },
    }));
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
