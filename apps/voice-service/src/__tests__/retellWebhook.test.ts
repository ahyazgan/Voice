// =============================================================================
// retellWebhook.test.ts — Retell webhook imza + call_ended çıkarımı
// =============================================================================
import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  verifyRetellSignature,
  extractCallEnded,
  type RetellWebhookBody,
} from '../providers/platform/retellWebhook.js';

const KEY = 'retell_test_key';
const NOW = 1_750_000_000_000; // sabit referans (ms)

/** Test için geçerli imza üret: HMAC-SHA256(rawBody + ts, key). */
function sign(rawBody: string, ts: number, key = KEY): string {
  const d = createHmac('sha256', key).update(rawBody + ts).digest('hex');
  return `v=${ts},d=${d}`;
}

describe('verifyRetellSignature', () => {
  const body = JSON.stringify({ event: 'call_ended', call: { call_id: 'x' } });

  it('geçerli imza + güncel timestamp → true', () => {
    expect(verifyRetellSignature(body, sign(body, NOW), KEY, NOW)).toBe(true);
  });

  it('yanlış key → false', () => {
    expect(verifyRetellSignature(body, sign(body, NOW, 'wrong'), KEY, NOW)).toBe(false);
  });

  it('gövde oynanmış → false (raw body imzalı)', () => {
    const tampered = body.replace('call_ended', 'call_started');
    expect(verifyRetellSignature(tampered, sign(body, NOW), KEY, NOW)).toBe(false);
  });

  it('5 dk+ eski timestamp → false (replay koruması)', () => {
    const old = NOW - 6 * 60 * 1000;
    expect(verifyRetellSignature(body, sign(body, old), KEY, NOW)).toBe(false);
  });

  it('imza header yok → false', () => {
    expect(verifyRetellSignature(body, undefined, KEY, NOW)).toBe(false);
  });

  it('bozuk header biçimi → false', () => {
    expect(verifyRetellSignature(body, 'garbage', KEY, NOW)).toBe(false);
  });

  it('key boş → false (asla geçme)', () => {
    expect(verifyRetellSignature(body, sign(body, NOW), '', NOW)).toBe(false);
  });
});

describe('extractCallEnded', () => {
  it('call_ended → callId(metadata) + recording + duration + cost', () => {
    const b: RetellWebhookBody = {
      event: 'call_ended',
      call: {
        call_id: 'retell_1',
        metadata: { callId: 'our_call_1', debtorId: 'd1' },
        recording_url: 'https://rec/x.wav',
        duration_ms: 92_000,
        call_cost: { combined_cost: 42 },
      },
    };
    const out = extractCallEnded(b);
    expect(out).toEqual({
      callId: 'our_call_1',
      recordingUrl: 'https://rec/x.wav',
      durationSec: 92, // 92000ms → 92s
      costMinor: 42,
    });
  });

  it('call_started → null (sadece call_ended işlenir)', () => {
    expect(extractCallEnded({ event: 'call_started', call: {} })).toBeNull();
  });

  it('eksik alanlar → undefined, patlama yok', () => {
    const out = extractCallEnded({ event: 'call_ended', call: { metadata: { callId: 'c1' } } });
    expect(out).toEqual({ callId: 'c1', recordingUrl: undefined, durationSec: undefined, costMinor: undefined });
  });
});
