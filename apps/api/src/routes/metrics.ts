import type { FastifyInstance } from 'fastify';
import { prisma } from '../db/index.js';
import { callQueue } from '../queue/index.js';
import { renderMetrics, QUEUE_STATES, type MetricsSnapshot } from './metricsRender.js';

/** Canlı snapshot'ı DB + kuyruktan toplar. */
async function collect(): Promise<MetricsSnapshot> {
  const [byStatus, byOutcome, queueCounts] = await Promise.all([
    prisma.call.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.call.groupBy({
      by: ['outcome'],
      where: { outcome: { not: null } },
      _count: { _all: true },
    }),
    callQueue.getJobCounts(...QUEUE_STATES),
  ]);

  const statusCounts: Record<string, number> = {};
  for (const row of byStatus) statusCounts[row.status] = row._count._all;

  const outcomeCounts: Record<string, number> = {};
  for (const row of byOutcome) {
    if (row.outcome) outcomeCounts[row.outcome] = row._count._all;
  }

  return { statusCounts, outcomeCounts, queueCounts };
}

/**
 * /metrics — Prometheus scrape ucu. /api dışında olduğu için panel-auth guard'ı
 * uygulanmaz (scraper insan token'ı taşımaz; /health, /ready ile aynı seviye).
 * Dağıtımda ağ politikası ile (internal-only) korunmalı.
 */
export async function metricsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/metrics', async (_req, reply) => {
    const snapshot = await collect();
    reply.header('content-type', 'text/plain; version=0.0.4; charset=utf-8');
    return renderMetrics(snapshot);
  });
}
