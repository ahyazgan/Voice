import { Queue, Worker, type JobsOptions } from 'bullmq';
import IORedis from 'ioredis';
import { env } from '../config.js';

export const CALL_QUEUE = 'calls';

export interface CallJobData {
  campaignId: string;
  callId: string;       // DB Call.id — voice-service'e bu ID ile başlatılır
  debtorId: string;
  attempt: number;
}

const connection = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
});

export const callQueue = new Queue<CallJobData>(CALL_QUEUE, { connection });

export async function enqueueCall(
  data: CallJobData,
  opts?: JobsOptions,
): Promise<void> {
  await callQueue.add(`call:${data.debtorId}`, data, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 60_000 },
    removeOnComplete: 1000,
    removeOnFail: 5000,
    ...opts,
  });
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
    { connection, concurrency },
  );
}
