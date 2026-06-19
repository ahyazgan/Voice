// =============================================================================
// providers/platform/vapi.ts — IOrchestrationPlatform (Vapi, Faz 1)
// =============================================================================
// Retell alternatifi (lock-in azaltır). Vapi de Custom-LLM modunda telefon +
// STT + TTS'i kendi yürütür; bizim iş mantığımıza OpenAI-UYUMLU /chat/completions
// ile ulaşır: Vapi her müşteri turunda assistant.model.url'imize bir POST atar
// (messages dizisi), biz son user mesajını TurnHandler'a verip OpenAI chat-
// completion formatında cevap döneriz. Vapi cevabı seslendirir.
//
// MİMARİ KÖPRÜ (retell.ts kalıbı): startCall() GİDEN REST (aramayı başlat); turlar
// GELEN HTTP'ten gelir → callId registry ile bağlanır. server.ts gelen POST'u
// handleVapiChatCompletion'a yönlendirir.
//
// Retell WS, Vapi HTTP — ikisi de aynı IOrchestrationPlatform.onTurn'ü besler.
// Vapi Custom LLM: https://docs.vapi.ai/customization/custom-llm/using-your-server
// =============================================================================

import type {
  IOrchestrationPlatform,
  PlatformCallOptions,
  PlatformCallSession,
  TranscriptTurn,
} from '@voice/shared';
import { maskPhone } from '@voice/shared';
import { logger } from '../../telemetry.js';

export interface VapiConfig {
  apiKey: string;
  assistantId: string;
  phoneNumberId: string;
}

interface PendingCall {
  options: PlatformCallOptions;
  session: VapiCallSession;
  history: TranscriptTurn[];
  turnIndex: number;
}

const registry = new Map<string, PendingCall>();

// --- OpenAI-uyumlu chat-completion tipleri (kullandığımız alt küme) ----------
interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }
export interface VapiChatRequest {
  messages: ChatMessage[];
  // Vapi metadata'yı call objesinde taşır; callId yola da konur.
  call?: { id?: string };
}

export class VapiOrchestrationPlatform implements IOrchestrationPlatform {
  readonly name = 'vapi';

  constructor(private readonly cfg: VapiConfig) {}

  async startCall(opts: PlatformCallOptions): Promise<PlatformCallSession> {
    const { debtor } = opts.callContext;
    const res = await fetch('https://api.vapi.ai/call/phone', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.cfg.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        assistantId: this.cfg.assistantId,
        phoneNumberId: this.cfg.phoneNumberId,
        customer: { number: debtor.phoneE164 },
        // Açılış cümlesi (KVKK rıza anonsu) + borçlu bağlamı dinamik değişkenle.
        assistantOverrides: {
          firstMessage: opts.openingUtterance,
          variableValues: { callId: opts.callContext.callId, debtorName: debtor.fullName },
        },
        metadata: { callId: opts.callContext.callId },
      }),
    });
    if (!res.ok) {
      throw new Error(`Vapi create-call başarısız: ${res.status}`);
    }
    const json = (await res.json()) as { id: string };

    const session = new VapiCallSession(this.cfg, opts.callContext.callId, json.id);
    registry.set(opts.callContext.callId, {
      options: opts,
      session,
      history: [],
      turnIndex: 0,
    });
    logger.info(
      { callId: opts.callContext.callId, vapiCallId: json.id, toMasked: maskPhone(debtor.phoneE164) },
      'vapi call placed; awaiting llm requests',
    );
    return session;
  }
}

class VapiCallSession implements PlatformCallSession {
  private ended = false;
  constructor(
    private readonly cfg: VapiConfig,
    readonly callId: string,
    private readonly vapiCallId: string,
  ) {}

  async end(reason?: string): Promise<void> {
    if (this.ended) return;
    this.ended = true;
    registry.delete(this.callId);
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 3000);
    try {
      await fetch(`https://api.vapi.ai/call/${this.vapiCallId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${this.cfg.apiKey}` },
        signal: ac.signal,
      });
    } catch (err) {
      logger.warn({ err, callId: this.callId, reason }, 'vapi end-call failed (ignored)');
    } finally {
      clearTimeout(timer);
    }
  }
}

export interface VapiChatResult {
  status: number;
  /** OpenAI-uyumlu chat-completion gövdesi (Vapi bunu seslendirir). */
  body: unknown;
}

/**
 * Gelen Vapi chat-completion isteğini işler (SAF — HTTP/Fastify'dan bağımsız).
 * server.ts POST gövdesini + yoldan callId'yi verir; biz reply'i OpenAI formatında
 * döneriz. Terminal turda end_call için Vapi'nin tool/end mekanizması ayrı; burada
 * en azından oturumu kapatırız.
 */
export async function handleVapiChatCompletion(
  callId: string,
  req: VapiChatRequest,
): Promise<VapiChatResult> {
  const pending = registry.get(callId);
  if (!pending) {
    logger.warn({ callId }, 'vapi llm request: no matching call session');
    return { status: 404, body: { error: 'unknown call' } };
  }

  const userText = extractLatestUser(req.messages);
  let reply: string;
  let shouldHangup = false;
  try {
    const decision = await pending.options.onTurn({ userText, turnIndex: pending.turnIndex++ });
    reply = decision.reply;
    shouldHangup = decision.shouldHangup;
    pending.history.push({ speaker: 'agent', text: reply, at: new Date().toISOString() });
    if (shouldHangup) {
      pending.options.onEnd?.({
        reason: `state_terminal:${decision.outcome ?? 'unknown'}`,
        transcript: pending.history,
        ...(decision.outcome !== undefined && { outcome: decision.outcome }),
      });
      await pending.session.end('state_terminal');
    }
  } catch (err) {
    logger.error({ err, callId }, 'vapi onTurn failed');
    reply = 'Şu an bir aksaklık var, sizi sonra tekrar arayacağız.';
    shouldHangup = true;
  }

  // OpenAI-uyumlu (non-streaming) chat-completion cevabı. Vapi `content`'i seslendirir.
  return {
    status: 200,
    body: {
      id: `chatcmpl-${callId}-${pending.turnIndex}`,
      object: 'chat.completion',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: reply },
          finish_reason: shouldHangup ? 'stop' : 'stop',
        },
      ],
    },
  };
}

function extractLatestUser(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role === 'user' && m.content.trim()) return m.content.trim();
  }
  return '';
}
