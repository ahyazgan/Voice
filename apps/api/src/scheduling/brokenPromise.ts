// =============================================================================
// scheduling/brokenPromise.ts — KIRILAN ÖDEME SÖZÜ DÖNGÜSÜ (saf karar)
// =============================================================================
// Tahsilat zekasının ayrıştırıcı parçası: söz verildi ama ödeme gelmedi.
// promise_followup (retryPolicy) "söz tarihi geldi, teyit et" demektir; BU ise
// "söz tarihi GEÇTİ ve ödeme GELMEDİ" — farklı, daha kısa-vadeli, farklı tonlu
// bir takip gerektirir. Söz tutulmaması KVKK taciz sınırlarını ESNETMEZ; her
// takip yine pencere + taciz kapılarından geçer.
//
// Saf: (söz + şu an) → karar. DB/queue işini brokenPromiseRunner yapar.
// =============================================================================

export interface BrokenPromiseConfig {
  /** Söz tarihinden kaç gün sonra "kırıldı" sayılır (grace). 0 = ertesi gün. */
  graceDays: number;
  /** Kırılan söz için en çok kaç takip araması (sonsuz ısrar = taciz). */
  maxFollowups: number;
  /** Takip araması bu kadar saat sonrasına planlanır (kısa vade). */
  followupDelayHours: number;
}

export interface BrokenPromiseInput {
  promisedDate: Date | null;
  /** Bu söz için şimdiye dek yapılmış kırık-söz takip sayısı. */
  followupsSoFar: number;
}

export interface BrokenPromiseDecision {
  /** Söz gerçekten kırılmış mı (vade + grace geçti, ödeme yok)? */
  isBroken: boolean;
  /** Kırıldıysa yeni bir takip araması planlanmalı mı? */
  schedule: boolean;
  notBefore?: Date;
  reason: string;
}

/**
 * Bir PROMISED ödemenin kırılıp kırılmadığına ve takip gerekip gerekmediğine
 * karar verir (SAF). Çağıran yalnızca status=PROMISED + ödeme gelmemiş kayıtları
 * verir; biz vade/grace ve takip limitini değerlendiririz.
 */
export function decideBrokenPromise(
  input: BrokenPromiseInput,
  cfg: BrokenPromiseConfig,
  now: Date,
): BrokenPromiseDecision {
  // Söz tarihi yoksa kırık sayma — belirsiz tarih takip edilemez (callback gibi ele alınır).
  if (!input.promisedDate) {
    return { isBroken: false, schedule: false, reason: 'no_promised_date' };
  }

  const breakAt = new Date(input.promisedDate.getTime() + cfg.graceDays * 86_400_000);
  if (now < breakAt) {
    return { isBroken: false, schedule: false, reason: 'not_yet_due' };
  }

  // Kırıldı. Takip limiti dolduysa işaretle ama yeni arama planlama.
  if (input.followupsSoFar >= cfg.maxFollowups) {
    return { isBroken: true, schedule: false, reason: 'broken_followups_exhausted' };
  }

  const notBefore = new Date(now.getTime() + cfg.followupDelayHours * 3_600_000);
  return { isBroken: true, schedule: true, notBefore, reason: 'broken_promise_followup' };
}
