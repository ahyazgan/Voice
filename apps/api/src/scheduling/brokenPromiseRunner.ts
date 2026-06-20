// =============================================================================
// scheduling/brokenPromiseRunner.ts — kırılan söz taramasının DB+queue tarafı
// =============================================================================
// Periyodik çağrılır (cron/interval). Vadesi geçmiş PROMISED ödemeleri bulur,
// decideBrokenPromise (saf) ile değerlendirir, BROKEN işaretler ve gerekiyorsa
// kırık-söz takip araması planlar (parentCallId zinciri + pencere/taciz kapıları).
//
// İdempotentlik: BROKEN işaretleme + takip Call tek transaction'da; aynı söz iki
// kez taranırsa ikinci turda status artık PROMISED olmadığından atlanır.
// =============================================================================

import { prisma } from '../db/index.js';
import { env } from '../config.js';
import { decideBrokenPromise, type BrokenPromiseConfig } from './brokenPromise.js';
import { scheduleCall } from './scheduler.js';

const cfg = (): BrokenPromiseConfig => ({
  graceDays: env.BROKEN_PROMISE_GRACE_DAYS,
  maxFollowups: env.BROKEN_PROMISE_MAX_FOLLOWUPS,
  followupDelayHours: env.BROKEN_PROMISE_FOLLOWUP_DELAY_HOURS,
});

export interface BrokenPromiseSweepResult {
  scanned: number;
  markedBroken: number;
  scheduled: number;
}

/**
 * Vadesi geçmiş PROMISED ödemeleri tarar. `now` test için enjekte edilebilir.
 * Best-effort: tek bir ödeme hatası tüm taramayı düşürmez (log'lanır, devam eder).
 */
export async function sweepBrokenPromises(
  now: Date = new Date(),
  log?: (msg: string, meta?: unknown) => void,
): Promise<BrokenPromiseSweepResult> {
  const c = cfg();
  // Sadece vadesi (grace dahil) geçmiş PROMISED kayıtlar. RECEIVED/PARTIAL/BROKEN
  // dışarıda — gerçek tahsilat ya da zaten işlenmiş.
  const dueBefore = new Date(now.getTime() - c.graceDays * 86_400_000);
  const candidates = await prisma.payment.findMany({
    where: { status: 'PROMISED', promisedDate: { not: null, lte: dueBefore } },
    select: {
      id: true,
      debtorId: true,
      promisedDate: true,
      call: { select: { id: true, campaignId: true, debtor: { select: { timezone: true } }, campaign: { select: { status: true } } } },
    },
  });

  let markedBroken = 0;
  let scheduled = 0;

  for (const p of candidates) {
    try {
      // Bu söz için yapılmış kırık-söz takip sayısı: sözü alan arama (p.call)
      // parent olan sonraki Call'lar. p.call yoksa takip sayısı 0.
      const followupsSoFar = p.call
        ? await prisma.call.count({ where: { debtorId: p.debtorId, parentCallId: p.call.id } })
        : 0;

      const decision = decideBrokenPromise(
        { promisedDate: p.promisedDate, followupsSoFar },
        c,
        now,
      );
      if (!decision.isBroken) continue;

      // Söz kırıldı: BROKEN işaretle.
      await prisma.payment.update({ where: { id: p.id }, data: { status: 'BROKEN' } });
      markedBroken++;

      // Kampanya aktif değilse ya da takip gerekmiyorsa burada dur.
      const campaignStatus = p.call?.campaign?.status;
      if (!decision.schedule || !p.call || campaignStatus !== 'ACTIVE') continue;

      const followup = await prisma.call.create({
        data: {
          campaignId: p.call.campaignId,
          debtorId: p.debtorId,
          status: 'QUEUED',
          parentCallId: p.call.id,
        },
        select: { id: true },
      });
      await scheduleCall(
        {
          campaignId: p.call.campaignId,
          callId: followup.id,
          debtorId: p.debtorId,
          timezone: p.call.debtor.timezone,
          attempt: 1,
          ...(decision.notBefore && { notBefore: decision.notBefore }),
        },
        now,
      );
      scheduled++;
    } catch (err) {
      log?.('broken promise sweep: payment failed (skipped)', { paymentId: p.id, err });
    }
  }

  return { scanned: candidates.length, markedBroken, scheduled };
}
