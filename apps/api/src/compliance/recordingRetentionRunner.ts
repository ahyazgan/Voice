// =============================================================================
// compliance/recordingRetentionRunner.ts — saklama taramasının DB+storage tarafı
// =============================================================================
// Periyodik çağrılır. Saklama süresi (RECORDING_RETENTION_DAYS) dolmuş, hâlâ
// recordingUrl taşıyan CallResult'ları bulur; storage'dan siler (varsa hook) ve
// DB'de recordingUrl=null yapar (uygulama artık kayda erişemez → veri minimizasyonu).
//
// İdempotent: recordingUrl null'landıktan sonra kayıt bir daha tarama setine girmez.
// Storage adapter (S3/GCS) henüz yoksa hook atlanır ama DB temizliği yine yapılır;
// adapter geldiğinde deleteRecording'i bağla (gerçek dosya silme).
// =============================================================================

import { prisma } from '../db/index.js';
import { env } from '../config.js';
import { recordingDeleteCutoff } from './recordingRetention.js';

export interface RetentionSweepResult {
  cutoff: string | null;
  scanned: number;
  deleted: number;
}

/**
 * Süresi dolmuş kayıtları temizler. `deleteRecording` verilirse her URL için
 * çağrılır (storage'dan gerçek silme); fırlatırsa o kayıt atlanır (DB'de URL
 * korunur → bir sonraki taramada yeniden denenir). `now` test için.
 */
export async function sweepExpiredRecordings(
  opts: {
    now?: Date;
    deleteRecording?: (url: string) => Promise<void>;
    log?: (msg: string, meta?: unknown) => void;
  } = {},
): Promise<RetentionSweepResult> {
  const now = opts.now ?? new Date();
  const cutoff = recordingDeleteCutoff(env.RECORDING_RETENTION_DAYS, now);
  if (!cutoff) return { cutoff: null, scanned: 0, deleted: 0 };

  // Süresi dolmuş + hâlâ kayıt URL'si taşıyan sonuçlar. Yaş ölçütü Call.endedAt
  // (kaydın oluştuğu an); yoksa Call.createdAt'e düş.
  const expired = await prisma.callResult.findMany({
    where: {
      recordingUrl: { not: null },
      call: { OR: [{ endedAt: { lt: cutoff } }, { endedAt: null, createdAt: { lt: cutoff } }] },
    },
    select: { callId: true, recordingUrl: true },
  });

  let deleted = 0;
  for (const r of expired) {
    try {
      if (opts.deleteRecording && r.recordingUrl) {
        await opts.deleteRecording(r.recordingUrl);
      }
      await prisma.callResult.update({
        where: { callId: r.callId },
        data: { recordingUrl: null },
      });
      deleted++;
    } catch (err) {
      // Storage silme başarısızsa DB'de URL'yi KORU → veri kaybolmaz, sonraki
      // taramada tekrar denenir. KVKK açısından silme tamamlanana dek tutarlı.
      opts.log?.('recording retention: delete failed (kept, will retry)', { callId: r.callId, err });
    }
  }

  return { cutoff: cutoff.toISOString(), scanned: expired.length, deleted };
}
