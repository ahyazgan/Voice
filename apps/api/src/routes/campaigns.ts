import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db/index.js';
import { enqueueCall } from '../queue/index.js';

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

  app.post('/campaigns', async (req, reply) => {
    const body = CreateCampaignSchema.parse(req.body);
    const campaign = await prisma.campaign.create({
      data: {
        name: body.name,
        calls: {
          create: body.debtorIds.map((debtorId) => ({ debtorId, status: 'QUEUED' })),
        },
      },
      include: { calls: true },
    });

    for (const call of campaign.calls) {
      await enqueueCall({
        campaignId: campaign.id,
        callId: call.id,
        debtorId: call.debtorId,
        attempt: 1,
      });
    }

    reply.code(201);
    return campaign;
  });
}
