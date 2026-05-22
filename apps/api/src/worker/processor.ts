import WebSocket from 'ws';
import { prisma } from '../db/index.js';
import { env } from '../config.js';
import type { CallJobData } from '../queue/index.js';

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
    include: { debtor: true },
  });
  if (!call) {
    // Call silinmiş veya hiç oluşmamış — sessizce başarılı.
    return;
  }
  if (call.status === 'COMPLETED') {
    // Idempotent: zaten bitmiş aramayı tekrar arama.
    return;
  }

  await prisma.call.update({
    where: { id: call.id },
    data: { status: 'RUNNING', startedAt: new Date(), attempt: data.attempt },
  });

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
        invoiceRef: call.debtor.invoiceRef ?? undefined,
      },
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
}

function runVoiceCall(args: RunArgs): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(env.VOICE_WS_URL);
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
          consent: false,
        }),
      );
    });

    ws.on('close', () => finish());
    ws.on('error', (err) => finish(err));
  });
}
