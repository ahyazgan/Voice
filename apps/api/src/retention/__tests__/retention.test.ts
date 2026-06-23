// =============================================================================
// retention.test.ts — saklama eşiği hesabı (saf)
// =============================================================================
import { describe, it, expect } from 'vitest';
import { cutoff } from '../retention.js';

describe('cutoff', () => {
  it('now - days (gün) eşik tarihini verir', () => {
    const now = new Date('2026-06-23T12:00:00.000Z');
    expect(cutoff(now, 90).toISOString()).toBe('2026-03-25T12:00:00.000Z');
    expect(cutoff(now, 365).toISOString()).toBe('2025-06-23T12:00:00.000Z');
  });

  it('0 gün → now', () => {
    const now = new Date('2026-06-23T12:00:00.000Z');
    expect(cutoff(now, 0).getTime()).toBe(now.getTime());
  });
});
