// =============================================================================
// orchestrator.streaming.test.ts — LLM streaming yolu (cümle cümle TTS)
// =============================================================================
// streamReply implement eden bir LLM ile orchestrator'ın cümleleri TTS'e
// AKITTIĞINI ve state machine'i ilerlettiğini doğrular.
// =============================================================================

import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import type {
  AudioChunk, CallContext, Debtor, ILLMProvider, ISTTProvider, ITTSProvider,
  LLMRequest, LLMStructuredOutput, STTEvent, STTSession, StructuredStream, TelephonySession, TTSOptions,
} from '@voice/shared';
import { Orchestrator } from '../orchestrator.js';

class FakeSTTSession implements STTSession {
  private em = new EventEmitter();
  push(): void {}
  onEvent(h: (e: STTEvent) => void): void { this.em.on('event', h); }
  async close(): Promise<void> { this.em.removeAllListeners(); }
  final(text: string, durationMs = 1000): void { this.em.emit('event', { type: 'final', text, durationMs }); }
}
class FakeSTT implements ISTTProvider {
  readonly name = 'fake';
  session = new FakeSTTSession();
  createSession(): STTSession { return this.session; }
}

// Her speak çağrısının metnini kaydeden TTS (cümle başına bir synth çağrısı bekleriz).
class RecordingTTS implements ITTSProvider {
  readonly name = 'rec';
  spokenTexts: string[] = [];
  async *synthesizeStream(text: string, _o: TTSOptions): AsyncIterable<AudioChunk> {
    this.spokenTexts.push(text);
    yield { data: new Uint8Array([1]), sampleRate: 8000, encoding: 'pcmu' };
  }
}

// streamReply implement eden LLM: 3 cümle yield eder, sonra structured output döner.
class StreamingLLM implements ILLMProvider {
  readonly name = 'streaming';
  async respond(_req: LLMRequest): Promise<LLMStructuredOutput> {
    return { say: 'fallback', intent: 'IDENTITY_CONFIRMED' };
  }
  async *streamReply(_req: LLMRequest): StructuredStream {
    yield 'Merhaba Ayşe Hanım.';
    yield 'Sizi rahatsız ediyorum.';
    yield 'Müsait misiniz?';
    return { say: 'Merhaba Ayşe Hanım. Sizi rahatsız ediyorum. Müsait misiniz?', intent: 'IDENTITY_CONFIRMED', usage: { tokensIn: 100, tokensOut: 30 } };
  }
}

function fakeSession(): TelephonySession {
  const em = new EventEmitter();
  return {
    callId: 'c1',
    onAudio() {},
    onHangup(h: () => void) { em.on('hangup', h); },
    sendAudio() {},
    stopPlayback() {},
    async hangup() { em.emit('hangup'); },
  } as TelephonySession;
}

function ctx(): CallContext {
  const debtor: Debtor = {
    id: 'd1', fullName: 'Ayşe Demir', phoneE164: '+905551112233',
    amountDue: 100000, currency: 'TRY', dueDate: new Date('2026-04-01').toISOString(),
  };
  return { callId: 'c1', debtor, startedAt: new Date().toISOString(), consentToRecord: true };
}

describe('Orchestrator streaming yolu', () => {
  it('say cümleleri ayrı ayrı TTS\'e basılır + state ilerler', async () => {
    const stt = new FakeSTT();
    const tts = new RecordingTTS();
    const orch = new Orchestrator(
      { stt, tts, llm: new StreamingLLM() },
      { callContext: ctx(), session: fakeSession(), sampleRate: 8000 },
    );
    await orch.start(); // consent anonsu (1 synth)
    const consentCount = tts.spokenTexts.length;

    stt.session.final('Evet benim'); // greeting→identify; IDENTITY_CONFIRMED → remind
    // streaming async; kısa bekle
    await new Promise((r) => setTimeout(r, 50));

    // Consent + 3 cümle ayrı ayrı seslendirildi.
    const turnTexts = tts.spokenTexts.slice(consentCount);
    expect(turnTexts).toEqual([
      'Merhaba Ayşe Hanım.',
      'Sizi rahatsız ediyorum.',
      'Müsait misiniz?',
    ]);
    expect(orch.getSnapshot().transcript.some((t) => t.speaker === 'agent' && t.text.includes('Müsait misiniz?'))).toBe(true);
  });
});
