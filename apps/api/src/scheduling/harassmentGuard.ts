// =============================================================================
// scheduling/harassmentGuard.ts — KVKK TACİZ SINIRI (DB kapısı)
// =============================================================================
// Pencere içinde olsa bile aşırı sıklıkta arama TACİZ sayılır. Bu kapı, bir
// borçluya günlük/haftalık/toplam arama sayısını sınırlar (arama saati
// penceresinden BAĞIMSIZ ek kapı).
//
// İlke: limit doluysa arama DÜŞÜRÜLMEZ — limit penceresi açılınca yeniden
// zamanlanır (`nextEligibleAt`). Kalıcı opt-out (doNotCall) ise asla.
//
// Saf hesap (gün/hafta sınırı, limit değerlendirme) harassmentMath.ts'tedir
// (test edilebilir, DB'siz). Bu dosya yalnızca DB sayımını yapar.
// =============================================================================

import { Prisma } from '@prisma/client';
import { prisma } from '../db/index.js';
import { env } from '../config.js';
import {
  evaluateLimits,
  startOfLocalDay,
  startOfLocalWeek,
  addDays,
  type HarassmentLimits,
} from './harassmentMath.js';

const limitsFromEnv = (): HarassmentLimits => ({
  perDay: env.MAX_CALLS_PER_DEBTOR_PER_DAY,
  perWeek: env.MAX_CALLS_PER_DEBTOR_PER_WEEK,
  total: env.MAX_TOTAL_CALLS_PER_DEBTOR,
});

export interface CallabilityResult {
  allowed: boolean;
  reason?: 'do_not_call' | 'daily' | 'weekly' | 'total';
  /** allowed=false ve geçici sınırsa: bu zamandan sonra tekrar denenebilir. */
  nextEligibleAt?: Date;
}

/**
 * Bir borçluya ŞU AN arama yapılabilir mi? doNotCall + günlük/haftalık/toplam
 * limitleri DB sayımıyla kontrol eder. Sayılan aramalar: fiilen yapılmış olanlar
 * (RUNNING/COMPLETED). SCHEDULED/QUEUED/CANCELLED/SKIPPED sayılmaz (henüz aranmadı).
 */
export async function canCallDebtor(
  debtorId: string,
  timeZone: string,
  now: Date = new Date(),
  // Transaction içinde (claimCallSlot) çağrılabilsin diye client enjekte edilir.
  db: Prisma.TransactionClient = prisma,
): Promise<CallabilityResult> {
  const debtor = await db.debtor.findUnique({
    where: { id: debtorId },
    select: { doNotCall: true },
  });
  if (!debtor || debtor.doNotCall) return { allowed: false, reason: 'do_not_call' };

  const dayStart = startOfLocalDay(now, timeZone);
  const weekStart = startOfLocalWeek(now, timeZone);
  const counted = ['RUNNING', 'COMPLETED'] as const;

  const [today, thisWeek, total] = await Promise.all([
    db.call.count({ where: { debtorId, status: { in: [...counted] }, startedAt: { gte: dayStart } } }),
    db.call.count({ where: { debtorId, status: { in: [...counted] }, startedAt: { gte: weekStart } } }),
    db.call.count({ where: { debtorId, status: { in: [...counted] } } }),
  ]);

  const verdict = evaluateLimits({ today, thisWeek, total }, limitsFromEnv());
  if (verdict.allowed) return { allowed: true };

  if (verdict.reason === 'daily') {
    return { allowed: false, reason: 'daily', nextEligibleAt: addDays(dayStart, 1) };
  }
  if (verdict.reason === 'weekly') {
    return { allowed: false, reason: 'weekly', nextEligibleAt: addDays(weekStart, 7) };
  }
  return { allowed: false, reason: 'total' };
}

export interface ClaimResult {
  claimed: boolean;
  reason?: CallabilityResult['reason'];
}

/**
 * ATOMİK slot kapma. Worker, aramayı fiilen başlatmadan (RUNNING) hemen önce
 * çağırır. Per-borçlu Postgres advisory lock altında taciz kapısını değerlendirir
 * ve uygunsa Call'u RUNNING'e çeker — tek transaction'da.
 *
 * Neden: canCallDebtor sayımı (oku) ile RUNNING'e geçiş (yaz) ayrı olduğunda,
 * aynı borçluya ait iki job eşzamanlı işlenirse ikisi de limiti "dolmamış" görüp
 * birlikte arar (TOCTOU). Advisory lock bu iki adımı borçlu bazında serileştirir;
 * lock transaction sonunda otomatik bırakılır.
 */
export async function claimCallSlot(
  callId: string,
  debtorId: string,
  timeZone: string,
  attempt: number,
  now: Date = new Date(),
): Promise<ClaimResult> {
  return prisma.$transaction(async (tx) => {
    // hashtext(debtorId) → advisory lock anahtarı; aynı borçlu için seri.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${debtorId}))`;

    const verdict = await canCallDebtor(debtorId, timeZone, now, tx);
    if (!verdict.allowed) return { claimed: false, reason: verdict.reason };

    await tx.call.update({
      where: { id: callId },
      data: { status: 'RUNNING', startedAt: now, attempt },
    });
    return { claimed: true };
  });
}
