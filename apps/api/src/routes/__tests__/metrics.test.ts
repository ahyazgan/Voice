// =============================================================================
// metrics.test.ts — Prometheus exposition üretimi (saf)
// =============================================================================
import { describe, it, expect } from 'vitest';
import { renderMetrics, type MetricsSnapshot } from '../metricsRender.js';

const empty: MetricsSnapshot = { statusCounts: {}, outcomeCounts: {}, queueCounts: {} };

describe('renderMetrics', () => {
  it('eksik enum etiketlerini 0 ile doldurur (stabil seri)', () => {
    const out = renderMetrics(empty);
    // Tüm status ve outcome serileri mevcut, değer 0.
    expect(out).toContain('voice_calls_status{status="QUEUED"} 0');
    expect(out).toContain('voice_calls_status{status="SKIPPED"} 0');
    expect(out).toContain('voice_calls_outcome{outcome="PROMISE_TO_PAY"} 0');
    expect(out).toContain('voice_queue_jobs{state="waiting"} 0');
  });

  it('verilen sayıları yansıtır', () => {
    const out = renderMetrics({
      statusCounts: { RUNNING: 2, COMPLETED: 5 },
      outcomeCounts: { PROMISE_TO_PAY: 3, NO_ANSWER: 1 },
      queueCounts: { waiting: 7, active: 2 },
    });
    expect(out).toContain('voice_calls_status{status="RUNNING"} 2');
    expect(out).toContain('voice_calls_status{status="COMPLETED"} 5');
    expect(out).toContain('voice_calls_outcome{outcome="PROMISE_TO_PAY"} 3');
    expect(out).toContain('voice_calls_outcome{outcome="NO_ANSWER"} 1');
    expect(out).toContain('voice_queue_jobs{state="waiting"} 7');
    expect(out).toContain('voice_queue_jobs{state="active"} 2');
  });

  it('geçerli exposition: HELP/TYPE satırları ve sonda newline', () => {
    const out = renderMetrics(empty);
    expect(out).toContain('# HELP voice_calls_status');
    expect(out).toContain('# TYPE voice_calls_status gauge');
    expect(out.endsWith('\n')).toBe(true);
    // Her metrik satırı "ad{...} sayı" biçiminde.
    for (const line of out.split('\n')) {
      if (line === '' || line.startsWith('#')) continue;
      expect(line).toMatch(/^[a-z_]+\{[a-z]+="[A-Z_a-z]+"\} \d+$/);
    }
  });
});
