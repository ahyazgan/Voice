// =============================================================================
// metricsRender.ts — Prometheus exposition üretimi (SAF, yan-etkisiz import).
// prisma/queue gibi bağlantı açan modüllere bağımlı DEĞİL → test edilebilir.
// =============================================================================

// Stabil seri için tüm enum etiketlerini sıfırla-doldur (Prometheus'ta seri
// kaybolmasın → rate()/alert kuralları sağlam kalsın). schema.prisma ile eş.
export const CALL_STATUSES = [
  'QUEUED',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'SCHEDULED',
  'CANCELLED',
  'SKIPPED',
] as const;

export const CALL_OUTCOMES = [
  'PROMISE_TO_PAY',
  'DISPUTE',
  'WRONG_NUMBER',
  'NO_ANSWER',
  'CALLBACK_REQUESTED',
  'ESCALATED_TO_HUMAN',
  'REFUSED',
] as const;

export const QUEUE_STATES = [
  'waiting',
  'active',
  'delayed',
  'completed',
  'failed',
  'paused',
] as const;

export interface MetricsSnapshot {
  statusCounts: Record<string, number>;
  outcomeCounts: Record<string, number>;
  queueCounts: Record<string, number>;
}

/** Saf: snapshot → Prometheus text exposition (test edilebilir). */
export function renderMetrics(s: MetricsSnapshot): string {
  const lines: string[] = [];

  lines.push('# HELP voice_calls_status Aramaların duruma göre sayısı');
  lines.push('# TYPE voice_calls_status gauge');
  for (const status of CALL_STATUSES) {
    lines.push(`voice_calls_status{status="${status}"} ${s.statusCounts[status] ?? 0}`);
  }

  lines.push('# HELP voice_calls_outcome Tamamlanan aramaların sonuca göre sayısı');
  lines.push('# TYPE voice_calls_outcome gauge');
  for (const outcome of CALL_OUTCOMES) {
    lines.push(`voice_calls_outcome{outcome="${outcome}"} ${s.outcomeCounts[outcome] ?? 0}`);
  }

  lines.push('# HELP voice_queue_jobs BullMQ kuyruk işlerinin duruma göre sayısı');
  lines.push('# TYPE voice_queue_jobs gauge');
  for (const state of QUEUE_STATES) {
    lines.push(`voice_queue_jobs{state="${state}"} ${s.queueCounts[state] ?? 0}`);
  }

  return lines.join('\n') + '\n';
}
