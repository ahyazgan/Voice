import Fastify from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import { env } from './config.js';
import { debtorsRoutes } from './routes/debtors.js';
import { campaignsRoutes } from './routes/campaigns.js';
import { callsRoutes } from './routes/calls.js';
import { authRoutes } from './routes/auth.js';
import { createCallWorker } from './queue/index.js';
import { processCallJob } from './worker/processor.js';
import { verifyToken } from './auth/token.js';
import { bearer } from './routes/auth.js';

const app = Fastify({ logger: { level: env.LOG_LEVEL } });

await app.register(cors, { origin: true });
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
await app.register(authRoutes, { prefix: '/api' });

// BullMQ worker: kuyruktaki aramaları voice-service'e WS ile tetikler.
const worker = createCallWorker(async (data) => {
  app.log.info({ callId: data.callId, attempt: data.attempt }, 'processing call');
  await processCallJob(data);
}, env.WORKER_CONCURRENCY);

worker.on('failed', (job, err) => {
  app.log.warn({ jobId: job?.id, err: err.message }, 'call job failed');
});

await app.listen({ port: env.API_PORT, host: '0.0.0.0' });
app.log.info({ workerConcurrency: env.WORKER_CONCURRENCY, voiceWsUrl: env.VOICE_WS_URL }, 'api ready');

// Graceful shutdown — uçtaki job'ları tamamlat, bağlantıları kapat.
const shutdown = async (signal: NodeJS.Signals) => {
  app.log.info({ signal }, 'shutting down');
  await Promise.allSettled([worker.close(), app.close()]);
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
