// =============================================================================
// persist.kvkk.test.ts — finalize POST'un KVKK + auth davranışı
// =============================================================================
// Doğrulanan:
//   1. Rıza YOKSA recordingUrl finalize gövdesinden DÜŞER (veri minimizasyonu).
//   2. Rıza VARSA recordingUrl geçer.
//   3. INTERNAL_API_SECRET ayarlıysa x-internal-secret header'ı eklenir.
// fetch mock'lanır; gerçek API gerekmez.
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// config.ts env'i import-time parse eder; testte API_BASE_URL + secret lazım.
vi.stubEnv('API_BASE_URL', 'http://api.local');
vi.stubEnv('INTERNAL_API_SECRET', 'shhh');

const { postFinalize } = await import('../persist.js');
import type { CallFinalSummary } from '../telemetry.js';

const fetchMock = vi.fn();

function summary(): CallFinalSummary {
  return {
    durationSec: 42,
    costBreakdown: {
      telephonySec: 42,
      sttSec: 0,
      llmTokensIn: 100,
      llmTokensOut: 20,
      ttsChars: 80,
      totalTRY: 0,
    },
    avgResponseMs: 500,
    p95ResponseMs: 600,
    turns: 3,
    bargeIns: 0,
  };
}

function lastBody(): Record<string, unknown> {
  const init = fetchMock.mock.calls.at(-1)?.[1] as { body: string };
  return JSON.parse(init.body);
}
function lastHeaders(): Record<string, string> {
  const init = fetchMock.mock.calls.at(-1)?.[1] as { headers: Record<string, string> };
  return init.headers;
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, status: 200 });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('postFinalize — KVKK rıza', () => {
  it('rıza YOKSA recordingUrl gönderilmez', async () => {
    await postFinalize({
      callId: 'c1',
      outcome: 'PROMISE_TO_PAY',
      consentToRecord: false,
      recordingUrl: 'https://rec.example/abc.mp3',
      summary: summary(),
      transcript: [],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(lastBody().recordingUrl).toBeUndefined();
  });

  it('consentToRecord verilmezse de (undefined) recordingUrl düşer — güvenli varsayılan', async () => {
    await postFinalize({
      callId: 'c2',
      outcome: 'PROMISE_TO_PAY',
      recordingUrl: 'https://rec.example/abc.mp3',
      summary: summary(),
      transcript: [],
    });
    expect(lastBody().recordingUrl).toBeUndefined();
  });

  it('rıza VARSA recordingUrl geçer', async () => {
    await postFinalize({
      callId: 'c3',
      outcome: 'PROMISE_TO_PAY',
      consentToRecord: true,
      recordingUrl: 'https://rec.example/abc.mp3',
      summary: summary(),
      transcript: [],
    });
    expect(lastBody().recordingUrl).toBe('https://rec.example/abc.mp3');
  });

  it('INTERNAL_API_SECRET header olarak eklenir', async () => {
    await postFinalize({
      callId: 'c4',
      outcome: 'NO_ANSWER',
      summary: summary(),
      transcript: [],
    });
    expect(lastHeaders()['x-internal-secret']).toBe('shhh');
  });
});
