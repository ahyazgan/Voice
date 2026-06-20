import Fastify from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import { env } from './config.js';
import { debtorsRoutes } from './routes/debtors.js';
import { campaignsRoutes } from './routes/campaigns.js';
import { callsRoutes } from './routes/calls.js';
import { authRoutes } from './routes/auth.js';
import { createCallWorker, redisPing } from './queue/index.js';
import { prisma } from './db/index.js';
import { processCallJob } from './worker/processor.js';
import { sweepBrokenPromises } from './scheduling/brokenPromiseRunner.js';
import { sweepExpiredRecordings } from './compliance/recordingRetentionRunner.js';
import { getRecordingStore } from './compliance/store.js';
import { verifyToken } from './auth/token.js';
import { bearer } from './routes/auth.js';

const app = Fastify({ logger: { level: env.LOG_LEVEL } });

await app.register(cors, { origin: true });
await app.register(sensible);

// Liveness: süreç ayakta mı (bağımlılık kontrolü yok — restart kararı için).
app.get('/health', async () => ({ ok: true }));

// Readiness: DB + Redis erişilebilir mi. Unhealthy ise 503 → LB trafiği kesmeli.
// Bağımlılık çökmüşken "sağlıklı" görünüp sessizce istek yutmayı önler.
app.get('/ready', async (_req, reply) => {
  const checks: Record<string, 'ok' | 'fail'> = {};
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.db = 'ok';
  } catch {
    checks.db = 'fail';
  }
  try {
    await redisPing();
    checks.redis = 'ok';
  } catch {
    checks.redis = 'fail';
  }
  const ready = Object.values(checks).every((v) => v === 'ok');
  if (!ready) reply.code(503);
  return { ready, checks };
});

// Panel auth guard: PANEL_AUTH_SECRET ayarlıysa /api/* okuma/yazma uçları
// geçerli bearer token ister. Muaf: /api/login (token almak için), ve
// /api/calls/:id/finalize (servis-içi INTERNAL_API_SECRET ile korunur — voice
// -service insan token'ı taşımaz). Secret yoksa guard kapalı (yerel dev).
app.addHook('preHandler', async (req, reply) => {
  if (!env.PANEL_AUTH_SECRET) return;
  const url = req.url.split('?')[0] ?? '';
  if (!url.startsWith('/api/')) return; // /health vb.
  if (url === '/api/login') return;
  if (url.endsWith('/finalize') && req.method === 'POST') return; // internal-secret korur
  const token = bearer(req.headers.authorization);
  if (!token || !verifyToken(token, env.PANEL_AUTH_SECRET)) {
    reply.code(401);
    return reply.send({ error: 'unauthorized' });
  }
});

await app.register(debtorsRoutes, { prefix: '/api' });
await app.register(campaignsRoutes, { prefix: '/api' });
await app.register(callsRoutes, { prefix: '/api' });
await app.register(authRoutes, { prefix: '/api' });

// BullMQ worker: kuyruktaki aramaları voice-service'e WS ile tetikler.
const worker = createCallWorker(async (data) => {
  app.log.info({ callId: data.callId, attempt: data.attempt }, 'processing call');
  await processCallJob(data);
}, env.WORKER_CONCURRENCY);

worker.on('failed', (job, err) => {
  app.log.warn({ jobId: job?.id, err: err.message }, 'call job failed');
});

// Kırılan ödeme sözü taraması: periyodik. Vadesi geçmiş PROMISED ödemeleri
// BROKEN işaretler + (gerekirse) kısa-vadeli takip araması planlar.
let brokenPromiseTimer: NodeJS.Timeout | undefined;
if (env.BROKEN_PROMISE_SWEEP_MINUTES > 0) {
  const runSweep = (): void => {
    void sweepBrokenPromises(new Date(), (msg, meta) => app.log.warn(meta ?? {}, msg))
      .then((r) => {
        if (r.markedBroken > 0 || r.scheduled > 0) {
          app.log.info(r, 'broken promise sweep');
        }
      })
      .catch((err) => app.log.error({ err }, 'broken promise sweep failed'));
  };
  brokenPromiseTimer = setInterval(runSweep, env.BROKEN_PROMISE_SWEEP_MINUTES * 60_000);
  brokenPromiseTimer.unref?.(); // process'i canlı tutmasın (worker zaten tutuyor)
}

// KVKK ses kaydı saklama taraması: süresi dolan kayıtları siler (recordingUrl null).
let recordingSweepTimer: NodeJS.Timeout | undefined;
if (env.RECORDING_SWEEP_HOURS > 0 && env.RECORDING_RETENTION_DAYS > 0) {
  const recordingStore = getRecordingStore();
  const runRetention = (): void => {
    void sweepExpiredRecordings({
      // Storage'dan gerçek silme; RECORDING_STORE=none ise no-op (yalnız DB temizlenir).
      deleteRecording: (url) => recordingStore.delete(url),
      log: (msg, meta) => app.log.warn(meta ?? {}, msg),
    })
      .then((r) => {
        if (r.deleted > 0) app.log.info(r, 'recording retention sweep');
      })
      .catch((err) => app.log.error({ err }, 'recording retention sweep failed'));
  };
  // Açılışta bir kez çalıştır (downtime'da biriken süresi dolmuşları hemen temizle).
  runRetention();
  recordingSweepTimer = setInterval(runRetention, env.RECORDING_SWEEP_HOURS * 3_600_000);
  recordingSweepTimer.unref?.();
}

await app.listen({ port: env.API_PORT, host: '0.0.0.0' });
app.log.info({ workerConcurrency: env.WORKER_CONCURRENCY, voiceWsUrl: env.VOICE_WS_URL }, 'api ready');

// Graceful shutdown — uçtaki job'ları tamamlat, bağlantıları kapat.
const shutdown = async (signal: NodeJS.Signals) => {
  app.log.info({ signal }, 'shutting down');
  if (brokenPromiseTimer) clearInterval(brokenPromiseTimer);
  if (recordingSweepTimer) clearInterval(recordingSweepTimer);
  await Promise.allSettled([worker.close(), app.close()]);
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
