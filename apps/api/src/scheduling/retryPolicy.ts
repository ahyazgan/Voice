// =============================================================================
// scheduling/retryPolicy.ts — OUTCOME-BAZLI TEKRAR DENEME (saf karar)
// =============================================================================
// İKİ FARKLI "retry" vardır, karıştırma:
//   1. BullMQ teknik retry (attempts/backoff): yalnızca ALTYAPI hatası (WS down).
//   2. Outcome-bazlı yeniden zamanlama (BU dosya): arama BAŞARIYLA tamamlandı ama
//      sonuç tekrar gerektiriyor (NO_ANSWER, PROMISE_TO_PAY takibi). Yeni Call + job.
//
// Bu modül saf: outcome + bağlam → karar. DB/queue işini finalize hook'u yapar.
// Tüm planlanan retry'lar yine pencere + taciz kapılarından geçer (scheduleCall).
// =============================================================================

import type { CallOutcome } from '@voice/shared';

export interface RetryConfig {
  noAnswerDelayHours: number;
  maxNoAnswerAttempts: number;
  promiseFollowupOffsetDays: number;
  refusedAfterDays: number;
}

export interface RetryContext {
  outcome: CallOutcome;
  /** Bu borç için şimdiye dek YAPILMIŞ arama sayısı (bu arama dahil). */
  attemptsSoFar: number;
  /** Aynı outcome ile kaç kez bitti (örn. kaçıncı NO_ANSWER). */
  sameOutcomeCount: number;
  /** PROMISE_TO_PAY / CALLBACK_REQUESTED için söz/randevu tarihi (varsa). */
  promisedDate?: Date | null;
}

export interface RetryDecision {
  /** Yeni bir takip/tekrar araması planlanmalı mı? */
  schedule: boolean;
  /** Planlanacaksa bu zamandan ÖNCE arama yapma (scheduleCall.notBefore). */
  notBefore?: Date;
  /** Borçluyu kalıcı opt-out'a al (WRONG_NUMBER). */
  markDoNotCall?: boolean;
  /** İnsan/legal kuyruğa düşür (DISPUTE/ESCALATED) — otomatik arama yok. */
  escalate?: boolean;
  reason: string;
}

/**
 * Bir aramanın sonucuna göre tekrar/takip kararı verir (SAF).
 * `now` referans anı (test için enjekte edilebilir).
 */
export function decideRetry(ctx: RetryContext, cfg: RetryConfig, now: Date): RetryDecision {
  switch (ctx.outcome) {
    case 'WRONG_NUMBER':
      // Yanlış numara: bir daha asla ara + kalıcı opt-out.
      return { schedule: false, markDoNotCall: true, reason: 'wrong_number_opt_out' };

    case 'NO_ANSWER': {
      if (ctx.sameOutcomeCount >= cfg.maxNoAnswerAttempts) {
        return { schedule: false, reason: 'no_answer_attempts_exhausted' };
      }
      const notBefore = new Date(now.getTime() + cfg.noAnswerDelayHours * 3_600_000);
      return { schedule: true, notBefore, reason: 'no_answer_retry' };
    }

    case 'CALLBACK_REQUESTED': {
      // Müşterinin istediği zamana planla; yoksa NO_ANSWER gibi davran.
      if (ctx.promisedDate && ctx.promisedDate > now) {
        return { schedule: true, notBefore: ctx.promisedDate, reason: 'callback_at_requested_time' };
      }
      const notBefore = new Date(now.getTime() + cfg.noAnswerDelayHours * 3_600_000);
      return { schedule: true, notBefore, reason: 'callback_no_time_given' };
    }

    case 'PROMISE_TO_PAY': {
      // Söz verilen tarihten offset gün sonra teyit/takip araması (kapalıysa yok).
      if (cfg.promiseFollowupOffsetDays <= 0) {
        return { schedule: false, reason: 'promise_followup_disabled' };
      }
      const base = ctx.promisedDate && ctx.promisedDate > now ? ctx.promisedDate : now;
      const notBefore = new Date(base.getTime() + cfg.promiseFollowupOffsetDays * 86_400_000);
      return { schedule: true, notBefore, reason: 'promise_followup' };
    }

    case 'REFUSED': {
      // Varsayılan: ısrar=taciz, tekrar yok. Env ile uzun cooldown açılabilir.
      if (cfg.refusedAfterDays <= 0) {
        return { schedule: false, reason: 'refused_no_retry' };
      }
      const notBefore = new Date(now.getTime() + cfg.refusedAfterDays * 86_400_000);
      return { schedule: true, notBefore, reason: 'refused_long_cooldown' };
    }

    case 'DISPUTE':
    case 'ESCALATED_TO_HUMAN':
      // Otomatik arama yok — insan/legal devralır.
      return { schedule: false, escalate: true, reason: 'needs_human' };

    default:
      return { schedule: false, reason: 'no_action' };
  }
}
