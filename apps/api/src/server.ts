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

const app = Fastify({ logger: { level: env.LOG_LEVEL } });

await app.register(cors, { origin: true });
await app.register(sensible);

app.get('/health', async () => ({ ok: true }));

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
