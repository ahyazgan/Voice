// =============================================================================
// turnHandler.resilience.test.ts — LLM hata/timeout dayanıklılığı
// =============================================================================
// LLM (respond/streamReply) fırlatırsa TurnHandler aramayı patlatmamalı;
// nazik bir fallback ile turu sürdürmeli (phase1 + orchestrator tutarlılığı).
import { describe, it, expect } from 'vitest';
import type {
  CallContext,
  Debtor,
  ILLMProvider,
  LLMRequest,
  LLMStructuredOutput,
  StructuredStream,
} from '@voice/shared';
import { TurnHandler } from '../turnHandler.js';

const debtor: Debtor = {
  id: 'd1',
  fullName: 'Ayşe Demir',
  phoneE164: '+905551112233',
  amountDue: 125000,
  currency: 'TRY',
  dueDate: '2026-04-01T00:00:00.000Z',
};
const ctx = (): CallContext => ({
  callId: 'c1',
  debtor,
  startedAt: new Date().toISOString(),
  consentToRecord: false,
});

class ThrowingLLM implements ILLMProvider {
  readonly name = 'throwing';
  async respond(_req: LLMRequest): Promise<LLMStructuredOutput> {
    throw new Error('llm timeout');
  }
}

class ThrowingStreamLLM implements ILLMProvider {
  readonly name = 'throwing-stream';
  async respond(_req: LLMRequest): Promise<LLMStructuredOutput> {
    return { say: 'x', intent: 'NO_RESPONSE' };
  }
  // eslint-disable-next-line require-yield
  async *streamReply(_req: LLMRequest): StructuredStream {
    throw new Error('llm stream fail');
  }
}

describe('TurnHandler LLM hata dayanıklılığı', () => {
  it('respond fırlatırsa: patlamaz, nazik fallback, akış canlı', async () => {
    const turn = new TurnHandler(ctx(), new ThrowingLLM());
    const d = await turn.handleUserText('Alo?');
    expect(d.shouldHangup).toBe(false);
    expect(d.reply).toMatch(/aksaklık|tekrar/i);
    expect(d.state).toBe('identify'); // state ilerlemedi ama tur düşmedi
  });

  it('streamReply fırlatırsa: fallback TurnDecision döner', async () => {
    const turn = new TurnHandler(ctx(), new ThrowingStreamLLM());
    expect(turn.supportsStreaming).toBe(true);
    const gen = turn.handleUserTextStreaming('Alo?');
    const r = await gen.next();
    expect(r.done).toBe(true);
    if (!r.done) throw new Error('done bekleniyordu');
    expect(r.value.shouldHangup).toBe(false);
    expect(r.value.reply).toMatch(/aksaklık|tekrar/i);
  });
});
