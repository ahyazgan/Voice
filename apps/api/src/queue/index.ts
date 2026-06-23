import { Queue, Worker, type JobsOptions } from 'bullmq';
import { Redis } from 'ioredis';
import { env } from '../config.js';

export const CALL_QUEUE = 'calls';

export interface CallJobData {
  campaignId: string;
  callId: string;       // DB Call.id — voice-service'e bu ID ile başlatılır
  debtorId: string;
  attempt: number;
}

const connection = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
});

export const callQueue = new Queue<CallJobData>(CALL_QUEUE, { connection });

export async function enqueueCall(
  data: CallJobData,
  opts?: JobsOptions,
): Promise<void> {
  await callQueue.add(`call:${data.debtorId}`, data, {
    // Deterministik jobId: aynı (callId, attempt) için çift job'u BullMQ engeller
    // (yarış/yeniden-zamanlama çift aramaya yol açmasın).
    jobId: `${data.callId}:${data.attempt}`,
    attempts: 3,
    backoff: { type: 'exponential', delay: 60_000 },
    removeOnComplete: 1000,
    removeOnFail: 5000,
    ...opts,
  });
}

/**
 * Bir kampanyaya ait HENÜZ ÇALIŞMAMIŞ job'ları (waiting/delayed/paused) kuyruktan
 * kaldırır. RUNNING (active) job'lara dokunmaz — onlar doğal biter. Duraklat/iptal
 * akışında kullanılır. Döndürdüğü sayı = kaldırılan job adedi.
 *
 * Not: BullMQ'da data alanına göre doğrudan sorgu yok; getJobs + filtre. Kampanya
 * ölçeği büyürse jobId konvansiyonu (`${campaignId}:${callId}`) ile optimize edilebilir.
 */
export async function removeCampaignJobs(campaignId: string): Promise<number> {
  const jobs = await callQueue.getJobs(['waiting', 'delayed', 'paused']);
  let removed = 0;
  for (const job of jobs) {
    if (job?.data?.campaignId === campaignId) {
      try {
        await job.remove();
        removed++;
      } catch {
        // Job araya çalışmaya başlamış olabilir (active'e geçti) — remove reddeder; atla.
      }
    }
  }
  return removed;
}

/** Graceful shutdown: kuyruk + Redis bağlantısını kapatır. */
export async function closeQueue(): Promise<void> {
  await callQueue.close();
  await connection.quit();
}

/** Readiness: Redis erişilebilir mi? Erişilemezse fırlatır. */
export async function pingRedis(): Promise<void> {
  await connection.ping();
}

export function createCallWorker(
  processor: (data: CallJobData) => Promise<void>,
  concurrency = 4,
): Worker<CallJobData> {
  return new Worker<CallJobData>(
    CALL_QUEUE,
    async (job) => {
      await processor(job.data);
    },
    {
      connection,
      concurrency,
      // Hız limiti: pencere içinde en çok N arama işlenir. Concurrency eşzamanlı
      // hat sayısını, limiter ise zaman-bazlı debiyi sınırlar (operatör/maliyet).
      limiter: { max: env.CALL_RATE_MAX, duration: env.CALL_RATE_DURATION_MS },
    },
  );
}
