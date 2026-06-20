import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db/index.js';
import { env } from '../config.js';
import { runRetryForFinalizedCall } from '../scheduling/retryRunner.js';

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
  disputeReason: z.string().optional(),
  paymentMethod: z.enum(['BANK_TRANSFER', 'CASH', 'CARD', 'INSTALLMENT']).optional(),
  recordingUrl: z.string().url().optional(),
  // KVKK: kayıt rızası verildi mi (Retell webhook recordingUrl'i sonradan yazabilsin).
  recordingConsent: z.boolean().default(false),

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
  // Faz 1: platformun raporladığı toplam maliyet (TRY). Varsa costTRY bununla
  // doldurulur (Faz 1'de telemetri STT/TTS'i bilmez → cost.totalTRY eksik).
  platformCostTRY: z.number().nonnegative().optional(),

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

    const call = await prisma.call.findUnique({ where: { id } });
    if (!call) {
      reply.code(404);
      return { error: 'not_found' };
    }
    if (call.status === 'COMPLETED') {
      // Idempotent: voice-service retry'ı / çift finalize zararsız.
      reply.code(200);
      return { ok: true, alreadyFinalized: true };
    }

    // Platform maliyeti varsa onu kullan (Faz 1: STT/TTS telemetri'de yok →
    // cost.totalTRY LLM-only ve eksik). Yoksa telemetri toplamı (Faz 2: tam).
    const effectiveCostTRY = body.platformCostTRY ?? body.cost.totalTRY;
    const totalCostTRY = Math.round(effectiveCostTRY * 100); // TRY → kuruş (DB int)

    try {
    await prisma.$transaction([
      prisma.call.update({
        where: { id },
        data: {
          status: 'COMPLETED',
          endedAt: new Date(),
          durationSec: Math.round(body.durationSec),
          // Outcome denormu: retry/raporlama sorgularında CallResult join'i gerekmesin.
          outcome: body.outcome,
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
          recordingConsent: body.recordingConsent,
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
          recordingConsent: body.recordingConsent,
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
      // Ödeme sözü alındıysa takip için bir Payment(PROMISED) aç. Idempotent
      // re-finalize: önce bu call'a bağlı eski PROMISED kaydı sil (tutar değişmiş
      // olabilir), sonra yeniden oluştur. RECEIVED/PARTIAL kayıtlara DOKUNMA —
      // onlar gerçek tahsilatı temsil eder, asla silinmez.
      ...(body.outcome === 'PROMISE_TO_PAY' && body.promisedAmount && body.promisedAmount > 0
        ? [
            prisma.payment.deleteMany({ where: { callId: id, status: 'PROMISED' } }),
            prisma.payment.create({
              data: {
                debtorId: call.debtorId,
                callId: id,
                amount: body.promisedAmount,
                status: 'PROMISED',
                method: body.paymentMethod ?? 'UNKNOWN',
                promisedDate: body.promisedDate ? new Date(body.promisedDate) : null,
              },
            }),
          ]
        : []),
    ]);
    } catch (err) {
      // Transaction rollback → Call.status RUNNING'de kaldı. 500 dön ki
      // voice-service finalize'ı başarısız sayıp tekrar denesin (idempotent).
      req.log.error({ id, err }, 'finalize transaction failed');
      reply.code(500);
      return { error: 'finalize_failed', callId: id };
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

  // --- Retell event webhook'undan platform metadata (kayıt/maliyet/süre) -------
  // Finalize'dan AYRI ve sonra gelebilir. recordingUrl yalnızca CallResult'ta
  // recordingConsent=true ise yazılır (KVKK). cost/duration her zaman güncellenir.
  const RecordingCostInput = z.object({
    recordingUrl: z.string().url().optional(),
    durationSec: z.number().int().nonnegative().optional(),
    platformCostMinor: z.number().nonnegative().optional(),
  });

  app.post('/calls/:id/recording-cost', async (req, reply) => {
    if (!requireInternalSecret(req, reply)) return reply;
    const { id } = req.params as { id: string };
    const body = RecordingCostInput.parse(req.body);

    const result = await prisma.callResult.findUnique({
      where: { callId: id },
      select: { recordingConsent: true },
    });
    if (!result) {
      // Finalize henüz yazılmamış olabilir (webhook erken geldi). 202 → Retell
      // için yine de başarı; voice-service zaten 200 dönmüştü, retry istemiyoruz.
      reply.code(202);
      return { ok: false, reason: 'result_not_found_yet' };
    }

    const data: Record<string, unknown> = {};
    // KVKK: kayıt URL'sini SADECE rıza varsa yaz. Rıza yoksa sessizce atla.
    if (body.recordingUrl !== undefined && result.recordingConsent) {
      data.recordingUrl = body.recordingUrl;
    }
    if (body.durationSec !== undefined) data.durationSec = body.durationSec;
    if (body.platformCostMinor !== undefined) {
      data.costTRY = Math.round(body.platformCostMinor * env.RETELL_COST_MINOR_TO_KURUS);
    }

    if (Object.keys(data).length === 0) {
      return { ok: true, applied: [] as string[] };
    }

    // recordingUrl + durationSec Call'da, costTRY CallResult'ta; ikisini ayır.
    const { durationSec, ...resultData } = data as {
      durationSec?: number;
      recordingUrl?: string;
      costTRY?: number;
    };
    await prisma.$transaction([
      ...(Object.keys(resultData).length
        ? [prisma.callResult.update({ where: { callId: id }, data: resultData })]
        : []),
      ...(durationSec !== undefined
        ? [prisma.call.update({ where: { id }, data: { durationSec } })]
        : []),
    ]);

    req.log.info({ callId: id, applied: Object.keys(data) }, 'recording-cost applied');
    return { ok: true, applied: Object.keys(data) };
  });
}
