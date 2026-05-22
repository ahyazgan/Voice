import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db/index.js';

const TranscriptTurnInput = z.object({
  speaker: z.enum(['agent', 'customer', 'system']),
  text: z.string(),
  at: z.string().datetime(),
  latencyMs: z.number().int().nonnegative().optional(),
});

const FinalizeInput = z.object({
  outcome: z.enum([
    'PROMISE_TO_PAY',
    'DISPUTE',
    'WRONG_NUMBER',
    'NO_ANSWER',
    'CALLBACK_REQUESTED',
    'ESCALATED_TO_HUMAN',
    'REFUSED',
  ]),
  promisedAmount: z.number().int().nonnegative().optional(),
  promisedDate: z.string().datetime().optional(),
  disputeReason: z.string().optional(),
  recordingUrl: z.string().url().optional(),

  // Telemetri özeti
  durationSec: z.number().nonnegative(),
  avgResponseMs: z.number().int().nonnegative().optional(),
  p95ResponseMs: z.number().int().nonnegative().optional(),
  bargeIns: z.number().int().nonnegative().default(0),

  // CostBreakdown (kuruş cinsi yok; TRY/saniye/karakter/token)
  cost: z.object({
    telephonySec: z.number().int().nonnegative(),
    sttSec: z.number().int().nonnegative(),
    llmTokensIn: z.number().int().nonnegative(),
    llmTokensOut: z.number().int().nonnegative(),
    ttsChars: z.number().int().nonnegative(),
    totalTRY: z.number().nonnegative(),
  }),

  transcript: z.array(TranscriptTurnInput).default([]),
});

export async function callsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/calls', async () => {
    return prisma.call.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { debtor: true, result: true },
    });
  });

  app.get('/calls/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const call = await prisma.call.findUnique({
      where: { id },
      include: { debtor: true, result: true, transcript: true },
    });
    if (!call) {
      reply.code(404);
      return { error: 'not_found' };
    }
    return call;
  });

  /**
   * voice-service arama bittiğinde bu endpoint'i çağırır.
   * - Call: status=COMPLETED, endedAt, durationSec güncellenir.
   * - CallResult: outcome + cost + latency metrikleri yazılır (upsert).
   * - TranscriptTurn: tüm turlar bulk eklenir.
   * Tek transaction; orta yerde patlarsa hiçbiri yazılmaz.
   */
  app.post('/calls/:id/finalize', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = FinalizeInput.parse(req.body);

    const call = await prisma.call.findUnique({ where: { id } });
    if (!call) {
      reply.code(404);
      return { error: 'not_found' };
    }

    const totalCostTRY = Math.round(body.cost.totalTRY * 100); // TRY → kuruş (DB int)

    await prisma.$transaction([
      prisma.call.update({
        where: { id },
        data: {
          status: 'COMPLETED',
          endedAt: new Date(),
          durationSec: Math.round(body.durationSec),
        },
      }),
      prisma.callResult.upsert({
        where: { callId: id },
        create: {
          callId: id,
          outcome: body.outcome,
          promisedAmount: body.promisedAmount ?? null,
          promisedDate: body.promisedDate ? new Date(body.promisedDate) : null,
          disputeReason: body.disputeReason ?? null,
          recordingUrl: body.recordingUrl ?? null,
          costTRY: totalCostTRY,
          telephonySec: body.cost.telephonySec,
          sttSec: body.cost.sttSec,
          llmTokensIn: body.cost.llmTokensIn,
          llmTokensOut: body.cost.llmTokensOut,
          ttsChars: body.cost.ttsChars,
          avgResponseMs: body.avgResponseMs ?? null,
          p95ResponseMs: body.p95ResponseMs ?? null,
          bargeIns: body.bargeIns,
        },
        update: {
          outcome: body.outcome,
          promisedAmount: body.promisedAmount ?? null,
          promisedDate: body.promisedDate ? new Date(body.promisedDate) : null,
          disputeReason: body.disputeReason ?? null,
          recordingUrl: body.recordingUrl ?? null,
          costTRY: totalCostTRY,
          telephonySec: body.cost.telephonySec,
          sttSec: body.cost.sttSec,
          llmTokensIn: body.cost.llmTokensIn,
          llmTokensOut: body.cost.llmTokensOut,
          ttsChars: body.cost.ttsChars,
          avgResponseMs: body.avgResponseMs ?? null,
          p95ResponseMs: body.p95ResponseMs ?? null,
          bargeIns: body.bargeIns,
        },
      }),
      // Eski transkript varsa temizle (idempotent re-finalize için)
      prisma.transcriptTurn.deleteMany({ where: { callId: id } }),
      prisma.transcriptTurn.createMany({
        data: body.transcript.map((t) => ({
          callId: id,
          speaker: t.speaker,
          text: t.text,
          at: new Date(t.at),
          latencyMs: t.latencyMs ?? null,
        })),
      }),
    ]);

    reply.code(200);
    return { ok: true };
  });
}
