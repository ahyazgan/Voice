import { z } from 'zod';

const EnvSchema = z.object({
  API_PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string(),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  LOG_LEVEL: z.string().default('info'),

  // Worker → voice-service kontrol WS adresi
  VOICE_WS_URL: z.string().default('ws://localhost:8787'),
  // Bir aramanın azami süresi (ms). Aşılırsa worker WS'i kapatır, job fail eder.
  CALL_TIMEOUT_MS: z.coerce.number().int().positive().default(10 * 60 * 1000),
  // Eşzamanlı arama sayısı (BullMQ worker concurrency)
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(4),
});

export const env = EnvSchema.parse(process.env);
