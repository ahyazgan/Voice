import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db/index.js';
import { env } from '../config.js';
import { runRetryForFinalizedCall } from '../scheduling/retryRunner.js';
import { buildCallsCsv } from './callsCsv.js';

/**
 * Servis-içi auth: finalize gibi yazma endpoint'lerini korur. voice-service
 * `x-internal-secret` header'ı ile çağırır. Secret ayarlı değilse (yerel dev)
 * geçişe izin verilir ama UYARI loglanır — production'da ayarlanmalı.
 */
function requireInternalSecret(req: FastifyRequest, reply: FastifyReply): boolean {
  if (!env.INTERNAL_API_SECRET) {
    req.log.warn('INTERNAL_API_SECRET ayarlı değil — korumalı endpoint açık (yalnızca dev)');
    return true;
  }
  const provided = req.headers['x-internal-secret'];
  if (provided !== env.INTERNAL_API_SECRET) {
    reply.code(401);
    void reply.send({ error: 'unauthorized' });
    return false;
  }
  return true;
}

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
  callbackAt: z.string().datetime().optional(),
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
  const ListQuery = z.object({
    status: z
      .enum(['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'SCHEDULED', 'CANCELLED', 'SKIPPED'])
      .optional(),
    outcome: z
      .enum([
        'PROMISE_TO_PAY', 'DISPUTE', 'WRONG_NUMBER', 'NO_ANSWER',
        'CALLBACK_REQUESTED', 'ESCALATED_TO_HUMAN', 'REFUSED',
      ])
      .optional(),
    campaignId: z.string().optional(),
  });

  app.get('/calls', async (req) => {
    const q = ListQuery.parse(req.query);
    return prisma.call.findMany({
      where: {
        ...(q.status && { status: q.status }),
        ...(q.outcome && { outcome: q.outcome }),
        ...(q.campaignId && { campaignId: q.campaignId }),
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { debtor: true, result: true },
    });
  });

  // CSV dışa aktarım: liste ile aynı filtreler, 200 limiti yok (tüm sonuçlar).
  // find-my-way statik rotayı /calls/:id'den önce eşler.
  app.get('/calls/export.csv', async (req, reply) => {
    const q = ListQuery.parse(req.query);
    const rows = await prisma.call.findMany({
      where: {
        ...(q.status && { status: q.status }),
        ...(q.outcome && { outcome: q.outcome }),
        ...(q.campaignId && { campaignId: q.campaignId }),
      },
      orderBy: { createdAt: 'desc' },
      include: { debtor: true, result: true },
    });

    const csv = buildCallsCsv(
      rows.map((c) => ({
        fullName: c.debtor.fullName,
        phoneE164: c.debtor.phoneE164,
        amountDueKurus: c.debtor.amountDue,
        status: c.status,
        outcome: c.outcome,
        promisedAmountKurus: c.result?.promisedAmount ?? null,
        promisedDate: c.result?.promisedDate?.toISOString() ?? null,
        durationSec: c.durationSec,
        costKurus: c.result?.costTRY ?? null,
        createdAt: c.createdAt.toISOString(),
      })),
    );

    const stamp = new Date().toISOString().slice(0, 10);
    reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="aramalar-${stamp}.csv"`);
    // UTF-8 BOM: Excel Türkçe karakterleri doğru okusun.
    return reply.send('﻿' + csv);
  });

  app.get('/calls/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const call = await prisma.call.findUnique({
      where: { id },
      include: {
        debtor: true,
        result: true,
        transcript: { orderBy: { at: 'asc' } },
      },
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
    if (!requireInternalSecret(req, reply)) return reply;

    const { id } = req.params as { id: string };
    const body = FinalizeInput.parse(req.body);

    const totalCostTRY = Math.round(body.cost.totalTRY * 100); // TRY → kuruş (DB int)

    // ATOMİK idempotency: status'u koşullu (≠COMPLETED) çevirerek finalize'ı
    // "claim" ederiz. Eşzamanlı/çift finalize'da yalnızca BİRİ claim eder
    // (count=1); diğerleri count=0 görüp 'already' döner. Böylece sonuç tek kez
    // yazılır ve takip (followup) tek kez tetiklenir (çift followup yarışı kapanır).
    let state: 'finalized' | 'already' | 'notfound';
    try {
    state = await prisma.$transaction(async (tx) => {
      const claim = await tx.call.updateMany({
        where: { id, status: { not: 'COMPLETED' } },
        data: {
          status: 'COMPLETED',
          endedAt: new Date(),
          durationSec: Math.round(body.durationSec),
          // Outcome denormu: retry/raporlama sorgularında CallResult join'i gerekmesin.
          outcome: body.outcome,
        },
      });
      if (claim.count === 0) {
        const exists = await tx.call.findUnique({ where: { id }, select: { id: true } });
        return exists ? 'already' : 'notfound';
      }
      await tx.callResult.upsert({
        where: { callId: id },
        create: {
          callId: id,
          outcome: body.outcome,
          promisedAmount: body.promisedAmount ?? null,
          promisedDate: body.promisedDate ? new Date(body.promisedDate) : null,
          callbackAt: body.callbackAt ? new Date(body.callbackAt) : null,
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
          callbackAt: body.callbackAt ? new Date(body.callbackAt) : null,
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
      });
      // Eski transkript varsa temizle (idempotent re-finalize için)
      await tx.transcriptTurn.deleteMany({ where: { callId: id } });
      await tx.transcriptTurn.createMany({
        data: body.transcript.map((t) => ({
          callId: id,
          speaker: t.speaker,
          text: t.text,
          at: new Date(t.at),
          latencyMs: t.latencyMs ?? null,
        })),
      });
      return 'finalized';
    });
    } catch (err) {
      // Transaction rollback → Call.status RUNNING'de kaldı. 500 dön ki
      // voice-service finalize'ı başarısız sayıp tekrar denesin (idempotent).
      req.log.error({ id, err }, 'finalize transaction failed');
      reply.code(500);
      return { error: 'finalize_failed', callId: id };
    }

    if (state === 'notfound') {
      reply.code(404);
      return { error: 'not_found' };
    }
    if (state === 'already') {
      // Idempotent: voice-service retry'ı / çift finalize zararsız.
      reply.code(200);
      return { ok: true, alreadyFinalized: true };
    }

    // Outcome-bazlı takip/tekrar: yalnızca İLK finalize'da (yukarıda COMPLETED
    // dalı erken döndü → buraya tek kez gelinir). Best-effort: finalize yanıtını
    // bloklamaz, hata yalnızca loglanır.
    try {
      const result = await runRetryForFinalizedCall(
        id,
        body.outcome,
        body.promisedDate ? new Date(body.promisedDate) : null,
      );
      if (result?.scheduled) {
        req.log.info({ callId: id, reason: result.reason }, 'followup call scheduled');
      }
    } catch (err) {
      req.log.warn({ callId: id, err }, 'retry scheduling failed (ignored)');
    }

    reply.code(200);
    return { ok: true };
  });
}
