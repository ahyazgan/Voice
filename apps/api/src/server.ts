import Fastify from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import { env } from './config.js';
import { debtorsRoutes } from './routes/debtors.js';
import { campaignsRoutes } from './routes/campaigns.js';
import { callsRoutes } from './routes/calls.js';
import { statsRoutes } from './routes/stats.js';
import { authRoutes } from './routes/auth.js';
import { createCallWorker, closeQueue } from './queue/index.js';
import { processCallJob } from './worker/processor.js';
import { reapStuckCalls } from './worker/reaper.js';
import { prisma } from './db/index.js';
import { verifyToken } from './auth/token.js';
import { bearer } from './routes/auth.js';
import { runRetention } from './retention/retention.js';

const app = Fastify({ logger: { level: env.LOG_LEVEL } });

// CORS: PANEL_ORIGIN ayarlıysa allowlist (virgülle ayrılmış); yoksa dev'de tüm origin.
const corsOrigin = env.PANEL_ORIGIN
  ? env.PANEL_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean)
  : true;
await app.register(cors, { origin: corsOrigin });
await app.register(sensible);

app.get('/health', async () => ({ ok: true }));

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
await app.register(statsRoutes, { prefix: '/api' });
await app.register(authRoutes, { prefix: '/api' });

// BullMQ worker: kuyruktaki aramaları voice-service'e WS ile tetikler.
const worker = createCallWorker(async (data) => {
  app.log.info({ callId: data.callId, attempt: data.attempt }, 'processing call');
  await processCallJob(data);
}, env.WORKER_CONCURRENCY);

worker.on('failed', (job, err) => {
  app.log.warn({ jobId: job?.id, err: err.message }, 'call job failed');
});

// KVKK retention tarayıcısı: saklama süresi dolan kayıt/transkripti periyodik
// siler. Idempotent → çok-örnekte güvenli. Başlangıçta bir kez + aralıkla.
const sweepRetention = (): void => {
  void runRetention({
    recordingDays: env.RECORDING_RETENTION_DAYS,
    transcriptDays: env.TRANSCRIPT_RETENTION_DAYS,
  })
    .then((r) => app.log.info(r, 'retention sweep done'))
    .catch((err) => app.log.warn({ err }, 'retention sweep failed'));
};
sweepRetention();
const retentionTimer = setInterval(sweepRetention, env.RETENTION_SWEEP_INTERVAL_MS);
retentionTimer.unref();

// Stuck-call reaper: RUNNING'de takılı (finalize gelmemiş) aramaları kurtarır.
const sweepStuckCalls = (): void => {
  void reapStuckCalls(env.CALL_TIMEOUT_MS)
    .then((n) => {
      if (n > 0) app.log.warn({ reaped: n }, 'stuck calls reaped to FAILED');
    })
    .catch((err) => app.log.warn({ err }, 'stuck-call reaper failed'));
};
sweepStuckCalls();
const reaperTimer = setInterval(sweepStuckCalls, env.REAPER_INTERVAL_MS);
reaperTimer.unref();

await app.listen({ port: env.API_PORT, host: '0.0.0.0' });
app.log.info({ workerConcurrency: env.WORKER_CONCURRENCY, voiceWsUrl: env.VOICE_WS_URL }, 'api ready');

// Graceful shutdown — SIRALI: önce timer'lar, sonra worker (uçtaki job bitsin),
// sonra HTTP, en son kuyruk + Redis + Prisma bağlantıları. Sıra önemli: worker
// bitmeden app.close() finalize endpoint'ini kapatırsa uçtaki arama sonucu kaybolur.
const shutdown = async (signal: NodeJS.Signals) => {
  app.log.info({ signal }, 'shutting down');
  clearInterval(retentionTimer);
  clearInterval(reaperTimer);
  await worker.close(); // yeni job alma, aktif olanı bitir
  await app.close(); // HTTP'yi kapat (worker bittikten SONRA)
  await Promise.allSettled([closeQueue(), prisma.$disconnect()]);
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
