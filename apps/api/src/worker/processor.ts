import WebSocket from 'ws';
import { prisma } from '../db/index.js';
import { env } from '../config.js';
import type { CallJobData } from '../queue/index.js';
import { isCallableNow, scheduleCall } from '../scheduling/scheduler.js';
import { claimCallSlot } from '../scheduling/harassmentGuard.js';

/**
 * BullMQ job processor — kuyruktan bir aramayı alıp voice-service'i tetikler.
 *
 * Akış:
 *  1. Call row'u bul (callId üzerinden idempotent).
 *  2. Call.status = RUNNING, startedAt, attempt güncellenir.
 *  3. voice-service kontrol WS'ine bağlan, start frame gönder.
 *  4. WS kapanana dek bekle (voice-service finalize sonrası WS'i kapatır).
 *  5. WS close → job complete. WS error / timeout → job fail (BullMQ retry).
 *
 * voice-service ayrıca POST /api/calls/:id/finalize ile sonucu yazar; bu
 * processor finalize'i beklemez, sadece "arama bitti" sinyalini bekler.
 */
export async function processCallJob(data: CallJobData): Promise<void> {
  const call = await prisma.call.findUnique({
    where: { id: data.callId },
    include: { debtor: true, campaign: { select: { status: true } } },
  });
  if (!call) {
    // Call silinmiş veya hiç oluşmamış — sessizce başarılı.
    return;
  }
  if (call.status === 'COMPLETED') {
    // Idempotent: zaten bitmiş aramayı tekrar arama.
    return;
  }
  if (call.status === 'CANCELLED') {
    // Duraklat/iptal ile düşürülmüş — kaldırılamamış yarış job'u. Arama YAPMA.
    return;
  }
  if (call.campaign.status === 'PAUSED' || call.campaign.status === 'CANCELLED') {
    // Kampanya durduruldu ama job kuyruktan çekilemeden çalışmaya başladı.
    // Savunma kapısı: aramayı yapma, sessizce başarılı dön (retry tetikleme).
    return;
  }

  // Pencere savunma kapısı: delayed job tetiklendiğinde saat ilerlemiş/DST kaymış
  // olabilir. Pencere dışındaysak ARAMA YAPMA, bir sonraki açık pencereye yeniden
  // zamanla. Bu, scheduler'ın enqueue-zamanı hesabının ikinci doğrulamasıdır.
  if (!isCallableNow(call.debtor.timezone)) {
    await scheduleCall({
      campaignId: call.campaignId,
      callId: call.id,
      debtorId: call.debtorId,
      timezone: call.debtor.timezone,
      attempt: data.attempt,
    });
    return;
  }

  // KVKK taciz kapısı (ATOMİK): say + RUNNING'e geçişi per-borçlu advisory lock
  // altında yapar. Eşzamanlı bir job aynı borçlunun slotunu çoktan kullandıysa
  // (limit doldu) bu aramayı YAPMA — çift arama = taciz. SKIPPED'e çek, dön.
  const claim = await claimCallSlot(call.id, call.debtorId, call.debtor.timezone, data.attempt);
  if (!claim.claimed) {
    await prisma.call.update({ where: { id: call.id }, data: { status: 'SKIPPED' } });
    return;
  }

  // Cross-call memory: borçlunun bu aramadan ÖNCEKİ son tamamlanmış araması.
  // Best-effort — hata olursa hatırlama olmadan devam et (aramayı ASLA bozma).
  const priorCall = await loadPriorCall(call.debtorId, call.id);

  try {
    await runVoiceCall({
      callId: call.id,
      debtor: {
        id: call.debtor.id,
        fullName: call.debtor.fullName,
        phoneE164: call.debtor.phoneE164,
        amountDue: call.debtor.amountDue,
        currency: 'TRY' as const,
        dueDate: call.debtor.dueDate.toISOString(),
        ...(call.debtor.invoiceRef != null ? { invoiceRef: call.debtor.invoiceRef } : {}),
      },
      ...(priorCall ? { priorCall } : {}),
    });
  } catch (err) {
    // BullMQ retry edecek; failed final attempt'te status FAILED'e çekilir
    await prisma.call.update({
      where: { id: call.id },
      data: { status: 'FAILED', endedAt: new Date() },
    });
    throw err;
  }
}

interface PriorCallSummary {
  at: string;
  outcome: string; // CallOutcome; voice-service zod ile doğrular
  promisedAmount?: number;
  promisedDate?: string;
}

interface RunArgs {
  callId: string;
  debtor: {
    id: string;
    fullName: string;
    phoneE164: string;
    amountDue: number;
    currency: 'TRY';
    dueDate: string;
    invoiceRef?: string;
  };
  priorCall?: PriorCallSummary;
}

/**
 * Borçlunun verilen aramadan ÖNCEKİ son TAMAMLANMIŞ (outcome'lu) aramasının özeti.
 * cross-call memory için; voice-service prompt'a doğal "hatırlama" notu işler.
 * @@index([debtorId, createdAt]) bu sorguyu karşılar. Best-effort: hata→undefined.
 */
async function loadPriorCall(
  debtorId: string,
  currentCallId: string,
): Promise<PriorCallSummary | undefined> {
  try {
    const prior = await prisma.call.findFirst({
      where: {
        debtorId,
        status: 'COMPLETED',
        outcome: { not: null },
        id: { not: currentCallId },
      },
      orderBy: { createdAt: 'desc' },
      include: { result: true },
    });
    if (!prior || prior.outcome == null) return undefined;
    return {
      at: (prior.endedAt ?? prior.startedAt ?? prior.createdAt).toISOString(),
      outcome: prior.outcome,
      ...(prior.result?.promisedAmount != null
        ? { promisedAmount: prior.result.promisedAmount }
        : {}),
      ...(prior.result?.promisedDate != null
        ? { promisedDate: prior.result.promisedDate.toISOString() }
        : {}),
    };
  } catch {
    // Best-effort: cross-call memory bir "nice-to-have"; sorgu hatası aramayı
    // bozmamalı. Hatırlama olmadan sessizce devam (processor'da logger yok).
    return undefined;
  }
}

function runVoiceCall(args: RunArgs): Promise<void> {
  return new Promise((resolve, reject) => {
    // Servis-içi auth: voice-service /control INTERNAL_API_SECRET ister (ayarlıysa).
    const ws = new WebSocket(env.VOICE_WS_URL, {
      headers: env.INTERNAL_API_SECRET
        ? { authorization: `Bearer ${env.INTERNAL_API_SECRET}` }
        : {},
    });
    let settled = false;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve();
    };

    const timer = setTimeout(() => {
      try { ws.terminate(); } catch { /* noop */ }
      finish(new Error(`voice call timeout (${env.CALL_TIMEOUT_MS}ms)`));
    }, env.CALL_TIMEOUT_MS);

    ws.on('open', () => {
      ws.send(
        JSON.stringify({
          type: 'start',
          callId: args.callId,
          debtor: args.debtor,
          sampleRate: 16000,
          // KVKK: rıza politikası env'den (varsayılan güvenli=false). Rıza
          // anonsu her halükârda çalar; bu yalnızca kaydın saklanıp
          // saklanmayacağını belirler. Hardcode 'false' yerine yapılandırılabilir.
          consent: env.DEFAULT_RECORDING_CONSENT,
          // cross-call memory: önceki arama özeti (varsa). voice-service zod ile doğrular.
          ...(args.priorCall ? { priorCall: args.priorCall } : {}),
        }),
      );
    });

    ws.on('close', () => finish());
    ws.on('error', (err) => finish(err));
  });
}
