// =============================================================================
// retell.platform.test.ts — Retell Custom-LLM köprüsünün protokol doğrulaması
// =============================================================================
// Gerçek Retell hesabı OLMADAN, "gerçek arama" yolunun yazılım tarafını sınar:
//   1. startCall() → create-phone-call REST'ini doğru gövdeyle çağırır mı?
//      (fetch mock'lanır, registry'e oturum yazılır.)
//   2. handleRetellWebSocket() → Retell'in `response_required` event'ini alıp
//      TurnHandler kararını `response_type:"response"` + content + (terminal'de)
//      `end_call:true` olarak geri yollar mı?
//   3. Terminal turda onEnd outcome ile tetiklenir mi?
//
// Sahte WS: EventEmitter + send/close/readyState. Retell'in gönderdiği gerçek
// mesaj şekillerini besliyoruz; bizim gönderdiğimiz frame'leri yakalıyoruz.
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { WebSocket } from 'ws';
import type {
  CallContext,
  Debtor,
  PlatformCallOptions,
  PlatformTurnDecision,
} from '@voice/shared';
import {
  RetellOrchestrationPlatform,
  handleRetellWebSocket,
} from '../providers/platform/retell.js';

// --- Sahte Retell WS --------------------------------------------------------
class FakeWs extends EventEmitter {
  readonly OPEN = 1;
  readyState = 1;
  sent: unknown[] = [];
  closed = false;

  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }
  close(): void {
    this.closed = true;
    this.emit('close');
  }
  /** Retell'in gönderdiği bir event'i simüle et. */
  feed(event: unknown): void {
    this.emit('message', Buffer.from(JSON.stringify(event)));
  }
}

function makeDebtor(): Debtor {
  return {
    id: 'd1',
    fullName: 'Ayşe Demir',
    phoneE164: '+905551112233',
    amountDue: 125000,
    currency: 'TRY',
    dueDate: new Date('2026-04-01T00:00:00Z').toISOString(),
  };
}

function makeContext(callId: string): CallContext {
  return {
    callId,
    debtor: makeDebtor(),
    startedAt: new Date().toISOString(),
    consentToRecord: true,
  };
}

/** Belirli kararları sırayla döndüren onTurn; çağrı argümanlarını kaydeder. */
function scriptedOptions(
  callId: string,
  decisions: PlatformTurnDecision[],
): { options: PlatformCallOptions; ended: { reason: string; outcome?: string }[]; turns: string[] } {
  const ended: { reason: string; outcome?: string }[] = [];
  const turns: string[] = [];
  let i = 0;
  const options: PlatformCallOptions = {
    callContext: makeContext(callId),
    openingUtterance: 'Kayıt rıza anonsu.',
    onTurn: async ({ userText }) => {
      turns.push(userText);
      const d = decisions[i++];
      if (!d) throw new Error('scripted decisions exhausted');
      return d;
    },
    onEnd: (info) => {
      ended.push({ reason: info.reason, ...(info.outcome && { outcome: info.outcome }) });
    },
  };
  return { options, ended, turns };
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('RetellOrchestrationPlatform.startCall', () => {
  it('create-phone-call REST\'ini doğru gövdeyle çağırır', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ call_id: 'retell_abc' }),
    });

    const platform = new RetellOrchestrationPlatform({
      apiKey: 'sk_test',
      agentId: 'agent_1',
      fromNumberE164: '+908500000000',
    });

    const { options } = scriptedOptions('call_start_1', []);
    const session = await platform.startCall(options);

    expect(session.callId).toBe('call_start_1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.retellai.com/v2/create-phone-call');
    const body = JSON.parse((init as { body: string }).body);
    expect(body.to_number).toBe('+905551112233');
    expect(body.from_number).toBe('+908500000000');
    expect(body.override_agent_id).toBe('agent_1');
    expect(body.metadata.callId).toBe('call_start_1');
    expect(body.retell_llm_dynamic_variables.opening_utterance).toBe('Kayıt rıza anonsu.');
  });

  it('REST hata dönerse fırlatır', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 402, text: async () => 'no credit' });
    const platform = new RetellOrchestrationPlatform({
      apiKey: 'sk',
      agentId: 'a',
      fromNumberE164: '+90',
    });
    const { options } = scriptedOptions('call_err', []);
    await expect(platform.startCall(options)).rejects.toThrow(/402/);
  });
});

describe('handleRetellWebSocket — tur köprüsü', () => {
  async function place(callId: string, decisions: PlatformTurnDecision[]) {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ call_id: `retell_${callId}` }) });
    const platform = new RetellOrchestrationPlatform({
      apiKey: 'sk',
      agentId: 'a',
      fromNumberE164: '+90',
    });
    const scripted = scriptedOptions(callId, decisions);
    await platform.startCall(scripted.options);
    return scripted;
  }

  it('response_required → response frame döner, content = reply', async () => {
    const scripted = await place('call_ws_1', [
      { reply: 'Ayşe Hanım merhaba.', state: 'remind', shouldHangup: false },
    ]);
    const ws = new FakeWs();
    // end-call REST'i (terminal değil ama close'da çağrılabilir) için boş ok.
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });

    await handleRetellWebSocket(ws as unknown as WebSocket, 'call_ws_1');

    ws.feed({
      interaction_type: 'response_required',
      response_id: 3,
      transcript: [{ role: 'user', content: 'Evet benim' }],
    });
    await vi.waitFor(() => expect(ws.sent.length).toBeGreaterThan(0));

    expect(scripted.turns).toEqual(['Evet benim']);
    expect(ws.sent[0]).toMatchObject({
      response_type: 'response',
      response_id: 3,
      content: 'Ayşe Hanım merhaba.',
      content_complete: true,
    });
    expect((ws.sent[0] as { end_call?: boolean }).end_call).toBeUndefined();
  });

  it('terminal karar → end_call:true + onEnd outcome ile tetiklenir', async () => {
    const scripted = await place('call_ws_2', [
      {
        reply: 'Teyit ettim, iyi günler.',
        state: 'closing',
        shouldHangup: true,
        outcome: 'PROMISE_TO_PAY',
      },
    ]);
    const ws = new FakeWs();
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });

    await handleRetellWebSocket(ws as unknown as WebSocket, 'call_ws_2');
    ws.feed({
      interaction_type: 'response_required',
      response_id: 7,
      transcript: [{ role: 'user', content: 'Onaylıyorum' }],
    });

    await vi.waitFor(() => expect(ws.sent.length).toBeGreaterThan(0));
    expect(ws.sent[0]).toMatchObject({ end_call: true, content: 'Teyit ettim, iyi günler.' });
    await vi.waitFor(() =>
      expect(scripted.ended).toContainEqual({ reason: 'state_terminal:PROMISE_TO_PAY', outcome: 'PROMISE_TO_PAY' }),
    );
  });

  it('ping_pong / update_only event\'leri cevap üretmez', async () => {
    await place('call_ws_3', []);
    const ws = new FakeWs();
    await handleRetellWebSocket(ws as unknown as WebSocket, 'call_ws_3');

    ws.feed({ interaction_type: 'ping_pong', timestamp: 123 });
    ws.feed({ interaction_type: 'update_only' });
    // kısa bekleme: hiçbir frame gönderilmemeli
    await new Promise((r) => setTimeout(r, 30));
    expect(ws.sent).toHaveLength(0);
  });

  it('eşleşmeyen callId → 1011 ile kapatır', async () => {
    const ws = new FakeWs();
    const closeSpy = vi.fn();
    ws.close = ((code?: number) => {
      closeSpy(code);
      ws.closed = true;
    }) as FakeWs['close'];
    // graceMs=0: registry boş, grace beklemeden hemen kapatmalı.
    await handleRetellWebSocket(ws as unknown as WebSocket, 'nonexistent_call', 0);
    expect(closeSpy).toHaveBeenCalledWith(1011);
  });
});
