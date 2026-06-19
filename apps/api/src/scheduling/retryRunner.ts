// =============================================================================
// scheduling/retryRunner.ts — outcome-bazlı retry'ın DB+queue tarafı
// =============================================================================
// finalize hook'undan çağrılır. decideRetry (saf) kararını alıp DB'ye uygular:
//   - markDoNotCall → Debtor.doNotCall=true (WRONG_NUMBER)
//   - schedule → yeni Call (parentCallId zinciri) + scheduleCall (pencere+taciz)
// İdempotentlik: yalnızca İLK finalize'da çağrılmalı (çağıran sorumlu).
// =============================================================================

import { prisma } from '../db/index.js';
import { env } from '../config.js';
import { decideRetry, type RetryConfig } from './retryPolicy.js';
import { scheduleCall } from './scheduler.js';
import type { CallOutcome } from '@voice/shared';

const retryCfg = (): RetryConfig => ({
  noAnswerDelayHours: env.RETRY_NO_ANSWER_DELAY_HOURS,
  maxNoAnswerAttempts: env.MAX_NO_ANSWER_ATTEMPTS,
  promiseFollowupOffsetDays: env.PROMISE_FOLLOWUP_OFFSET_DAYS,
  refusedAfterDays: env.RETRY_REFUSED_AFTER_DAYS,
});

/**
 * Tamamlanmış bir aramanın sonucuna göre takip/tekrar planlar.
 * `callId` = az önce finalize edilen arama. Best-effort: hata raporlanır,
 * finalize yanıtını bloklamaz.
 */
export async function runRetryForFinalizedCall(
  callId: string,
  outcome: CallOutcome,
  promisedDate: Date | null,
  now: Date = new Date(),
): Promise<{ scheduled: boolean; reason: string } | null> {
  const call = await prisma.call.findUnique({
    where: { id: callId },
    select: {
      campaignId: true,
      debtorId: true,
      debtor: { select: { timezone: true } },
      campaign: { select: { status: true } },
    },
  });
  if (!call) return null;

  // Kampanya durdurulduysa takip planlama (iptal/duraklat ile çakışmasın).
  if (call.campaign.status === 'CANCELLED' || call.campaign.status === 'PAUSED') {
    return { scheduled: false, reason: 'campaign_not_active' };
  }

  // Bu borç için sayımlar (karar bağlamı).
  const [attemptsSoFar, sameOutcomeCount] = await Promise.all([
    prisma.call.count({ where: { debtorId: call.debtorId, status: { in: ['RUNNING', 'COMPLETED'] } } }),
    prisma.call.count({ where: { debtorId: call.debtorId, outcome } }),
  ]);

  const decision = decideRetry(
    { outcome, attemptsSoFar, sameOutcomeCount, promisedDate },
    retryCfg(),
    now,
  );

  if (decision.markDoNotCall) {
    await prisma.debtor.update({ where: { id: call.debtorId }, data: { doNotCall: true } });
  }

  if (!decision.schedule) {
    return { scheduled: false, reason: decision.reason };
  }

  // Yeni takip/tekrar araması: aynı kampanyada, parentCallId zinciriyle.
  const followup = await prisma.call.create({
    data: {
      campaignId: call.campaignId,
      debtorId: call.debtorId,
      status: 'QUEUED',
      parentCallId: callId,
    },
    select: { id: true },
  });

  await scheduleCall(
    {
      campaignId: call.campaignId,
      callId: followup.id,
      debtorId: call.debtorId,
      timezone: call.debtor.timezone,
      attempt: 1,
      ...(decision.notBefore && { notBefore: decision.notBefore }),
    },
    now,
  );

  return { scheduled: true, reason: decision.reason };
}
