// =============================================================================
// compliance/recordingRetention.ts — KVKK ses kaydı saklama süresi (saf karar)
// =============================================================================
// KVKK veri minimizasyonu: ses kaydı süresiz tutulamaz. Saklama süresi (gün)
// dolan kayıtlar silinir. Bu modül saf: "şu ana göre hangi tarihten ESKİ
// kayıtlar silinmeli" cutoff'unu hesaplar. DB/storage işini runner yapar.
// =============================================================================

/**
 * Saklama süresine göre silme cutoff tarihini döndürür: bu tarihten ÖNCE
 * oluşmuş kayıtlar süresini doldurmuştur. retentionDays<=0 → TTL kapalı (null).
 * `now` test için enjekte edilebilir.
 */
export function recordingDeleteCutoff(retentionDays: number, now: Date): Date | null {
  if (retentionDays <= 0) return null;
  return new Date(now.getTime() - retentionDays * 86_400_000);
}
