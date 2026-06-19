// =============================================================================
// retryPolicy.test.ts — outcome-bazlı tekrar deneme saf kararı
// =============================================================================
import { describe, it, expect } from 'vitest';
import { decideRetry, type RetryConfig, type RetryContext } from '../retryPolicy.js';

const cfg: RetryConfig = {
  noAnswerDelayHours: 4,
  maxNoAnswerAttempts: 3,
  promiseFollowupOffsetDays: 1,
  refusedAfterDays: 0, // varsayılan: REFUSED tekrar yok
};
const NOW = new Date('2026-06-15T12:00:00Z');

function ctx(outcome: RetryContext['outcome'], over: Partial<RetryContext> = {}): RetryContext {
  return { outcome, attemptsSoFar: 1, sameOutcomeCount: 1, ...over };
}

describe('decideRetry', () => {
  it('WRONG_NUMBER → tekrar yok + doNotCall', () => {
    const d = decideRetry(ctx('WRONG_NUMBER'), cfg, NOW);
    expect(d.schedule).toBe(false);
    expect(d.markDoNotCall).toBe(true);
  });

  it('NO_ANSWER (ilk) → 4 saat sonra tekrar', () => {
    const d = decideRetry(ctx('NO_ANSWER', { sameOutcomeCount: 1 }), cfg, NOW);
    expect(d.schedule).toBe(true);
    expect(d.notBefore?.toISOString()).toBe('2026-06-15T16:00:00.000Z');
  });

  it('NO_ANSWER limit dolunca tekrar yok', () => {
    const d = decideRetry(ctx('NO_ANSWER', { sameOutcomeCount: 3 }), cfg, NOW);
    expect(d.schedule).toBe(false);
    expect(d.reason).toBe('no_answer_attempts_exhausted');
  });

  it('CALLBACK_REQUESTED + tarih → o tarihe planla', () => {
    const when = new Date('2026-06-20T10:00:00Z');
    const d = decideRetry(ctx('CALLBACK_REQUESTED', { promisedDate: when }), cfg, NOW);
    expect(d.schedule).toBe(true);
    expect(d.notBefore?.toISOString()).toBe(when.toISOString());
  });

  it('CALLBACK_REQUESTED tarihsiz → NO_ANSWER gibi 4 saat sonra', () => {
    const d = decideRetry(ctx('CALLBACK_REQUESTED', { promisedDate: null }), cfg, NOW);
    expect(d.schedule).toBe(true);
    expect(d.notBefore?.toISOString()).toBe('2026-06-15T16:00:00.000Z');
  });

  it('PROMISE_TO_PAY → söz tarihinden +1 gün takip', () => {
    const promise = new Date('2026-06-18T00:00:00Z');
    const d = decideRetry(ctx('PROMISE_TO_PAY', { promisedDate: promise }), cfg, NOW);
    expect(d.schedule).toBe(true);
    expect(d.notBefore?.toISOString()).toBe('2026-06-19T00:00:00.000Z');
  });

  it('PROMISE_TO_PAY offset=0 → takip kapalı', () => {
    const d = decideRetry(ctx('PROMISE_TO_PAY', { promisedDate: NOW }), { ...cfg, promiseFollowupOffsetDays: 0 }, NOW);
    expect(d.schedule).toBe(false);
  });

  it('REFUSED varsayılan → tekrar yok', () => {
    const d = decideRetry(ctx('REFUSED'), cfg, NOW);
    expect(d.schedule).toBe(false);
    expect(d.reason).toBe('refused_no_retry');
  });

  it('REFUSED env ile cooldown → N gün sonra', () => {
    const d = decideRetry(ctx('REFUSED'), { ...cfg, refusedAfterDays: 7 }, NOW);
    expect(d.schedule).toBe(true);
    expect(d.notBefore?.toISOString()).toBe('2026-06-22T12:00:00.000Z');
  });

  it('DISPUTE → escalate, otomatik arama yok', () => {
    const d = decideRetry(ctx('DISPUTE'), cfg, NOW);
    expect(d.schedule).toBe(false);
    expect(d.escalate).toBe(true);
  });

  it('ESCALATED_TO_HUMAN → escalate', () => {
    const d = decideRetry(ctx('ESCALATED_TO_HUMAN'), cfg, NOW);
    expect(d.schedule).toBe(false);
    expect(d.escalate).toBe(true);
  });
});
