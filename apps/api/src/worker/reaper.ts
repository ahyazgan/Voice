// =============================================================================
// worker/reaper.ts — RUNNING'de takılı kalan aramaları kurtarır
// =============================================================================
// API yarıda çökerse (ya da voice-service finalize'ı kaybolursa) Call RUNNING'de
// kalır; ne biter ne retry tetiklenir. Reaper, CALL_TIMEOUT'tan eski RUNNING
// aramaları FAILED'a çeker — BullMQ retry'ı / raporlama bunları görebilsin.

import { prisma } from '../db/index.js';

/**
 * startedAt'i `maxAgeMs`'ten eski RUNNING aramaları FAILED'a çeker.
 * Döndürdüğü sayı = kurtarılan (reaped) arama adedi. Idempotent.
 */
export async function reapStuckCalls(maxAgeMs: number, now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - maxAgeMs);
  const r = await prisma.call.updateMany({
    where: { status: 'RUNNING', startedAt: { lt: cutoff } },
    data: { status: 'FAILED', endedAt: now },
  });
  return r.count;
}
