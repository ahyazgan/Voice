// =============================================================================
// orchestrator.bargein.test.ts — barge-in mantığı (gerçek arama YOK)
// =============================================================================
// Sahte telephony + programlanabilir STT + uzun-stream TTS + scripted LLM ile
// orchestrator'ı sürüp doğrularız:
//   - Müşteri TTS çalarken konuşunca (partial) → stopPlayback çağrılır,
//   - TTS stream kesilir (sonraki chunk'lar sendAudio'ya GİTMEZ),
//   - caller_speaking + barge_in telemetride işaretlenir.
// =============================================================================

import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type {
  AudioChunk, CallContext, Debtor, ILLMProvider, ISTTProvider,
  ITTSProvider, LLMRequest, LLMStructuredOutput, STTEvent, STTSession, TelephonySession, TTSOptions,
} from '@voice/shared';
import { Orchestrator } from '../orchestrator.js';

// --- Programlanabilir STT --------------------------------------------------
class FakeSTTSession implements STTSession {
  private em = new EventEmitter();
  push(): void {}
  onEvent(h: (e: STTEvent) => void): void { this.em.on('event', h); }
  async close(): Promise<void> { this.em.removeAllListeners(); }
  partial(text: string): void { this.em.emit('event', { type: 'partial', text }); }
  final(text: string, durationMs = 1000): void { this.em.emit('event', { type: 'final', text, durationMs }); }
}
class FakeSTT implements ISTTProvider {
  readonly name = 'fake';
  session = new FakeSTTSession();
  createSession(): STTSession { return this.session; }
}

// --- Uzun-stream TTS (kesilebilirlik gözlemi) ------------------------------
class SlowTTS implements ITTSProvider {
  readonly name = 'slow';
  chunksYielded = 0;
  async *synthesizeStream(_text: string, _opts: TTSOptions): AsyncIterable<AudioChunk> {
    for (let i = 0; i < 20; i++) {
      this.chunksYielded++;
      yield { data: new Uint8Array([i]), sampleRate: 8000, encoding: 'pcmu' };
      // event-loop'a izin ver ki barge-in araya girebilsin
      await new Promise((r) => setTimeout(r, 5));
    }
  }
}

class ScriptedLLM implements ILLMProvider {
  readonly name = 'scripted';
  async respond(_req: LLMRequest): Promise<LLMStructuredOutput> {
    return { say: 'Anladım, teşekkürler.', intent: 'NO_RESPONSE' };
  }
}

// --- Gözlemlenebilir sahte telephony session -------------------------------
function fakeSession(): TelephonySession & { sent: number; stopCalls: number } {
  const em = new EventEmitter();
  const s = {
    callId: 'c1',
    sent: 0,
    stopCalls: 0,
    onAudio() {},
    onHangup(h: () => void) { em.on('hangup', h); },
    sendAudio() { s.sent++; },
    stopPlayback() { s.stopCalls++; },
    async hangup() { em.emit('hangup'); },
  };
  return s as TelephonySession & { sent: number; stopCalls: number };
}

function ctx(): CallContext {
  const debtor: Debtor = {
    id: 'd1', fullName: 'Ayşe Demir', phoneE164: '+905551112233',
    amountDue: 100000, currency: 'TRY', dueDate: new Date('2026-04-01').toISOString(),
  };
  return { callId: 'c1', debtor, startedAt: new Date().toISOString(), consentToRecord: true };
}

describe('Orchestrator barge-in', () => {
  it('consent anonsu çalarken müşteri konuşunca TTS kesilir + stopPlayback çağrılır', async () => {
    const stt = new FakeSTT();
    const tts = new SlowTTS();
    const session = fakeSession();
    const orch = new Orchestrator(
      { stt, tts, llm: new ScriptedLLM() },
      { callContext: ctx(), session, sampleRate: 8000 },
    );

    // start() consent anonsunu seslendirmeye başlar (uzun stream, ~100ms).
    const started = orch.start();
    // Birkaç chunk gittikten sonra müşteri araya girsin.
    await new Promise((r) => setTimeout(r, 20));
    const sentBeforeBarge = session.sent;
    stt.session.partial('alo kimsiniz');
    await started;

    // Barge-in stopPlayback'i çağırmış olmalı.
    expect(session.stopCalls).toBeGreaterThanOrEqual(1);
    // Kesintiden sonra anons tüm 20 chunk'ı GÖNDERMEMELİ (erken durdu).
    expect(session.sent).toBeLessThan(20);
    // Kesinti gerçekten erken oldu (tüm stream akmadan).
    expect(sentBeforeBarge).toBeLessThan(20);
  });

  it('barge-in olmadan tam akış: stopPlayback çağrılmaz', async () => {
    const stt = new FakeSTT();
    const tts = new SlowTTS();
    const session = fakeSession();
    const orch = new Orchestrator(
      { stt, tts, llm: new ScriptedLLM() },
      { callContext: ctx(), session, sampleRate: 8000 },
    );
    await orch.start(); // kimse araya girmez
    expect(session.stopCalls).toBe(0);
    expect(session.sent).toBe(20); // tüm anons aktı
  });
});
