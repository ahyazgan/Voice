// =============================================================================
// scheduling/scheduler.ts — ARAMA ZAMANLAMA KATMANI
// =============================================================================
// "Bir aramayı ne zaman kuyruğa atmalı?" kararının tek noktası. campaigns route,
// resume ve (Aşama 4) outcome-bazlı retry hep buradan geçer.
//
// Şu an: arama saati penceresi (Aşama 2). Aşama 3'te KVKK taciz kapısı, Aşama 4'te
// retry buraya eklenir — hepsi aynı "en geç uygun zaman"ı hesaplayıp delayed job.
//
// İlke: pencere dışı = DÜŞÜRME, ZAMANLA. Call.status SCHEDULED + scheduledFor yazılır.
// =============================================================================

import { prisma } from '../db/index.js';
import { enqueueCall, type CallJobData } from '../queue/index.js';
import { env } from '../config.js';
import { isWithinWindow, nextWindowStart, parseWindowConfig } from './callWindow.js';
import { canCallDebtor } from './harassmentGuard.js';

const windowCfg = parseWindowConfig(env);

export interface ScheduleArgs {
  campaignId: string;
  callId: string;
  debtorId: string;
  timezone: string;
  attempt?: number;
  /** Bu zamandan ÖNCE arama yapma (retry/callback için). Pencere bununla AND'lenir. */
  notBefore?: Date;
}

export interface ScheduleResult {
  scheduledFor: Date | null;
  delayMs: number;
  immediate: boolean;
  /** Taciz/opt-out nedeniyle hiç kuyruğa alınmadıysa true (Call.status=SKIPPED). */
  skipped?: boolean;
  skipReason?: 'do_not_call' | 'total';
}

/**
 * Aramayı KVKK taciz kapısı + arama-penceresi (+ verilirse notBefore) kapılarından
 * geçirip kuyruğa atar. Kalıcı engel (doNotCall / toplam limit) → SKIPPED, kuyruğa
 * girmez. Geçici limit (günlük/haftalık) → o pencere açılınca yeniden zamanlanır.
 * Pencere dışı → bir sonraki açık pencereye delayed job.
 */
export async function scheduleCall(args: ScheduleArgs, now: Date = new Date()): Promise<ScheduleResult> {
  const tz = args.timezone || env.CALL_DEFAULT_TIMEZONE;

  // 1) KVKK taciz / opt-out kapısı.
  const callable = await canCallDebtor(args.debtorId, tz, now);
  if (!callable.allowed && (callable.reason === 'do_not_call' || callable.reason === 'total')) {
    // Kalıcı engel: hiç arama yapma.
    await prisma.call.update({ where: { id: args.callId }, data: { status: 'SKIPPED' } });
    return {
      scheduledFor: null,
      delayMs: 0,
      immediate: false,
      skipped: true,
      skipReason: callable.reason,
    };
  }

  // 2) Geçici taciz limiti (günlük/haftalık) varsa, sonraki uygunluk anını
  //    notBefore ile birleştir (EN GEÇİ kazanır).
  let earliest = args.notBefore && args.notBefore > now ? args.notBefore : now;
  if (!callable.allowed && callable.nextEligibleAt && callable.nextEligibleAt > earliest) {
    earliest = callable.nextEligibleAt;
  }

  // 3) Arama penceresi kapısı.
  const within = isWithinWindow(earliest, tz, windowCfg);
  const scheduledFor = within ? earliest : nextWindowStart(earliest, tz, windowCfg);
  const delayMs = Math.max(0, scheduledFor.getTime() - now.getTime());
  const immediate = delayMs === 0;

  const jobData: CallJobData = {
    campaignId: args.campaignId,
    callId: args.callId,
    debtorId: args.debtorId,
    attempt: args.attempt ?? 1,
  };
  await enqueueCall(jobData, delayMs > 0 ? { delay: delayMs } : undefined);

  await prisma.call.update({
    where: { id: args.callId },
    data: {
      status: immediate ? 'QUEUED' : 'SCHEDULED',
      scheduledFor,
    },
  });

  return { scheduledFor, delayMs, immediate };
}

/** Worker savunma kapısı: job çalışırken pencereyi tekrar doğrula. */
export function isCallableNow(timezone: string, now: Date = new Date()): boolean {
  return isWithinWindow(now, timezone || env.CALL_DEFAULT_TIMEZONE, windowCfg);
}

/** Worker pencere dışıysa yeniden zamanlamak için bir sonraki pencere başlangıcı. */
export function nextOpening(timezone: string, now: Date = new Date()): Date {
  return nextWindowStart(now, timezone || env.CALL_DEFAULT_TIMEZONE, windowCfg);
}
