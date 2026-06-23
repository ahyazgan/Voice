// =============================================================================
// retention/retention.ts — KVKK veri saklama / imha
// =============================================================================
// İki sorumluluk:
//  1. runRetention: saklama süresi dolan ses kaydı + transkriptleri periyodik siler.
//  2. eraseDebtorData: right-to-erasure — bir borçlunun tüm kayıt/transkriptini siler.
//
// İlke: CallResult satırı (outcome/maliyet — raporlama) KORUNUR; yalnızca PII
// içeriği (recordingUrl, transkript) düşürülür. Veri minimizasyonu.
//
// NOT: recordingUrl null'lanır; fiziksel ses objesinin (S3/dosya) silinmesi,
// storage entegrasyonu eklendiğinde buraya bağlanmalı (şu an URL'den ibaret).
// =============================================================================

import { prisma } from '../db/index.js';

/** now - days (gün) → eşik tarih. Saf, test edilebilir. */
export function cutoff(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

export interface RetentionResult {
  recordingsCleared: number;
  transcriptsDeleted: number;
}

export interface RetentionConfig {
  recordingDays: number;
  transcriptDays: number;
}

/**
 * Saklama süresi dolan veriyi siler. Idempotent: zaten null/silinmiş veri no-op,
 * bu yüzden çok-örnekli çalıştırma güvenli.
 */
export async function runRetention(cfg: RetentionConfig, now: Date = new Date()): Promise<RetentionResult> {
  const recordingCutoff = cutoff(now, cfg.recordingDays);
  const transcriptCutoff = cutoff(now, cfg.transcriptDays);

  const [cleared, deleted] = await Promise.all([
    prisma.callResult.updateMany({
      where: { recordingUrl: { not: null }, call: { createdAt: { lt: recordingCutoff } } },
      data: { recordingUrl: null },
    }),
    prisma.transcriptTurn.deleteMany({
      where: { call: { createdAt: { lt: transcriptCutoff } } },
    }),
  ]);

  return { recordingsCleared: cleared.count, transcriptsDeleted: deleted.count };
}

/**
 * Right-to-erasure: borçlunun TÜM aramalarının ses kaydı + transkriptini siler
 * ve doNotCall=true yapar (gelecekte de aranmaz). İmha talebinde çağrılır.
 */
export async function eraseDebtorData(debtorId: string): Promise<RetentionResult> {
  const [cleared, deleted] = await Promise.all([
    prisma.callResult.updateMany({
      where: { recordingUrl: { not: null }, call: { debtorId } },
      data: { recordingUrl: null },
    }),
    prisma.transcriptTurn.deleteMany({ where: { call: { debtorId } } }),
  ]);
  await prisma.debtor.update({ where: { id: debtorId }, data: { doNotCall: true } });
  return { recordingsCleared: cleared.count, transcriptsDeleted: deleted.count };
}
