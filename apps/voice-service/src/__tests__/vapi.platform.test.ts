// =============================================================================
// vapi.platform.test.ts — Vapi Custom-LLM köprüsü (gerçek hesap YOK)
// =============================================================================
// startCall REST'ini (fetch mock) + handleVapiChatCompletion köprüsünü sınar:
//   - create-call doğru gövdeyle çağrılır,
//   - chat-completion isteği → onTurn → OpenAI-uyumlu cevap,
//   - terminal turda onEnd outcome ile tetiklenir,
//   - eşleşmeyen callId → 404.
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { CallContext, Debtor, PlatformCallOptions, PlatformTurnDecision } from '@voice/shared';
import { VapiOrchestrationPlatform, handleVapiChatCompletion } from '../providers/platform/vapi.js';

const fetchMock = vi.fn();
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });
afterEach(() => vi.unstubAllGlobals());

function ctx(callId: string): CallContext {
  const debtor: Debtor = {
    id: 'd1', fullName: 'Ayşe Demir', phoneE164: '+905551112233',
    amountDue: 100000, currency: 'TRY', dueDate: new Date('2026-04-01').toISOString(),
  };
  return { callId, debtor, startedAt: new Date().toISOString(), consentToRecord: true };
}

function options(callId: string, decisions: PlatformTurnDecision[]) {
  const ended: { reason: string; outcome?: string }[] = [];
  const turns: string[] = [];
  let i = 0;
  const opts: PlatformCallOptions = {
    callContext: ctx(callId),
    openingUtterance: 'Rıza anonsu.',
    onTurn: async ({ userText }) => { turns.push(userText); return decisions[i++]!; },
    onEnd: (info) => ended.push({ reason: info.reason, ...(info.outcome && { outcome: info.outcome }) }),
  };
  return { opts, ended, turns };
}

function provider() {
  return new VapiOrchestrationPlatform({ apiKey: 'sk', assistantId: 'a1', phoneNumberId: 'p1' });
}

describe('VapiOrchestrationPlatform.startCall', () => {
  it('create-call REST\'ini doğru gövdeyle çağırır', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'vapi_1' }) });
    const { opts } = options('call_1', []);
    const session = await provider().startCall(opts);

    expect(session.callId).toBe('call_1');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.vapi.ai/call/phone');
    const body = JSON.parse((init as { body: string }).body);
    expect(body.assistantId).toBe('a1');
    expect(body.phoneNumberId).toBe('p1');
    expect(body.customer.number).toBe('+905551112233');
    expect(body.assistantOverrides.firstMessage).toBe('Rıza anonsu.');
  });

  it('REST hata → fırlatır', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 402 });
    const { opts } = options('c', []);
    await expect(provider().startCall(opts)).rejects.toThrow(/402/);
  });
});

describe('handleVapiChatCompletion', () => {
  async function place(callId: string, decisions: PlatformTurnDecision[]) {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ id: `vapi_${callId}` }) });
    const scripted = options(callId, decisions);
    await provider().startCall(scripted.opts);
    return scripted;
  }

  it('chat-completion → onTurn → OpenAI-uyumlu cevap', async () => {
    const scripted = await place('call_chat', [
      { reply: 'Ayşe Hanım merhaba.', state: 'remind', shouldHangup: false },
    ]);
    const result = await handleVapiChatCompletion('call_chat', {
      messages: [{ role: 'user', content: 'Evet benim' }],
    });

    expect(result.status).toBe(200);
    expect(scripted.turns).toEqual(['Evet benim']);
    const body = result.body as { choices: { message: { content: string } }[] };
    expect(body.choices[0]!.message.content).toBe('Ayşe Hanım merhaba.');
  });

  it('terminal karar → onEnd outcome ile tetiklenir', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) }); // end-call DELETE
    const scripted = await place('call_term', [
      { reply: 'İyi günler.', state: 'closing', shouldHangup: true, outcome: 'PROMISE_TO_PAY' },
    ]);
    await handleVapiChatCompletion('call_term', {
      messages: [{ role: 'user', content: 'Onaylıyorum' }],
    });
    expect(scripted.ended).toContainEqual({ reason: 'state_terminal:PROMISE_TO_PAY', outcome: 'PROMISE_TO_PAY' });
  });

  it('eşleşmeyen callId → 404', async () => {
    const result = await handleVapiChatCompletion('nope', { messages: [] });
    expect(result.status).toBe(404);
  });
});
