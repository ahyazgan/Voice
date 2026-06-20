// =============================================================================
// recordingRetention.test.ts — KVKK saklama cutoff saf kararı
// =============================================================================
import { describe, it, expect } from 'vitest';
import { recordingDeleteCutoff } from '../recordingRetention.js';

const NOW = new Date('2026-06-15T12:00:00Z');

describe('recordingDeleteCutoff', () => {
  it('retention 90 gün → cutoff = now - 90 gün', () => {
    const cutoff = recordingDeleteCutoff(90, NOW);
    expect(cutoff).toEqual(new Date('2026-03-17T12:00:00Z'));
  });

  it('retention 0 → TTL kapalı (null)', () => {
    expect(recordingDeleteCutoff(0, NOW)).toBeNull();
  });

  it('negatif retention → null (silme yapma)', () => {
    expect(recordingDeleteCutoff(-5, NOW)).toBeNull();
  });

  it('retention 1 gün → dünden eski', () => {
    expect(recordingDeleteCutoff(1, NOW)).toEqual(new Date('2026-06-14T12:00:00Z'));
  });
});
