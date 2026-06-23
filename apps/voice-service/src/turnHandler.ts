import type {
  CallContext,
  CallOutcome,
  ConversationState,
  ILLMProvider,
  TranscriptTurn,
} from '@voice/shared';
import { LLMStructuredOutputSchema } from '@voice/shared';
import {
  currentState,
  eventFromIntent,
  startConversation,
  type ConversationActor,
} from './stateMachine.js';
import { systemPromptFor } from './prompts/index.js';
import { logger } from './telemetry.js';

export interface TurnDecision {
  reply: string;
  shouldHangup: boolean;
  outcome?: CallOutcome;
  state: ConversationState;
  /** Bu turun LLM token kullanımı (maliyet telemetrisi için). Sağlayıcı vermezse yok. */
  usage?: { tokensIn: number; tokensOut: number };
}

/**
 * Audio transport'tan bağımsız, tek "tur" iş mantığı.
 * - Faz 1: orkestrasyon platformu her müşteri turunda çağırır.
 * - Faz 2: kendi `Orchestrator` sınıfımız STT final eventinde çağırır.
 *
 * Geri dönüş hep yapılandırılmış: serbest LLM cevabı YASAK.
 */
export class TurnHandler {
  private actor: ConversationActor;
  private history: TranscriptTurn[] = [];

  constructor(
    private readonly callContext: CallContext,
    private readonly llm: ILLMProvider,
  ) {
    this.actor = startConversation(callContext.debtor);
  }

  get transcript(): readonly TranscriptTurn[] {
    return this.history;
  }

  get outcome(): CallOutcome | undefined {
    return this.actor.getSnapshot().context.outcome ?? undefined;
  }

  /** Ödeme sözü tutarı (kuruş). Tahsilat ürününün ana çıktısı — finalize'a taşınmalı. */
  get promisedAmount(): number | undefined {
    return this.actor.getSnapshot().context.promisedAmount ?? undefined;
  }

  /** Ödeme sözü tarihi (ISO). */
  get promisedDate(): string | undefined {
    return this.actor.getSnapshot().context.promisedDate ?? undefined;
  }

  /** Borca itiraz gerekçesi (DISPUTE outcome'unda). */
  get disputeReason(): string | undefined {
    return this.actor.getSnapshot().context.disputeReason ?? undefined;
  }

  /** İstenen geri-arama zamanı (CALLBACK_REQUESTED outcome'unda). */
  get callbackAt(): string | undefined {
    return this.actor.getSnapshot().context.callbackAt ?? undefined;
  }

  get state(): ConversationState {
    return currentState(this.actor);
  }

  recordAgentUtterance(text: string): void {
    this.history.push({ speaker: 'agent', text, at: new Date().toISOString() });
  }

  /**
   * Streaming tur: say cümlelerini yield eder (orchestrator hemen TTS'e basar),
   * dönüşte TurnDecision (state ilerletilmiş). LLM streamReply DESTEKLEMİYORSA
   * çağıran handleUserText'e düşmeli (bu generator yalnızca destekliyse çağrılır).
   * reply = tüm cümlelerin birleşimi (history/transcript için).
   */
  async *handleUserTextStreaming(
    userText: string,
  ): AsyncGenerator<string, TurnDecision, void> {
    const startedAt = performance.now();
    this.history.push({ speaker: 'customer', text: userText, at: new Date().toISOString() });
    const state = currentState(this.actor);

    const stream = this.llm.streamReply!({
      systemPrompt: systemPromptFor(state, this.callContext),
      context: { callContext: this.callContext, state, history: this.history },
      userText,
    });

    const sentences: string[] = [];
    let result = await stream.next();
    while (!result.done) {
      sentences.push(result.value);
      yield result.value; // orchestrator TTS'e basar
      result = await stream.next();
    }
    const raw = result.value; // generator dönüş değeri = tam yapılandırılmış çıktı

    const parsed = LLMStructuredOutputSchema.safeParse(raw);
    if (!parsed.success) {
      logger.warn({ issues: parsed.error.issues, callId: this.callContext.callId }, 'llm stream output invalid');
      const reply = sentences.join(' ') || 'Sizi tam anlayamadım, tekrar eder misiniz?';
      this.recordAgentUtterance(reply);
      return { reply, shouldHangup: false, state };
    }

    const { say, intent, fields } = parsed.data;
    const event = eventFromIntent(intent, fields);
    if (event) this.actor.send(event);

    const snap = this.actor.getSnapshot();
    const nextState = snap.value as ConversationState;
    const shouldHangup = snap.status === 'done';
    const reply = sentences.join(' ') || say;

    this.history.push({
      speaker: 'agent',
      text: reply,
      at: new Date().toISOString(),
      latencyMs: Math.round(performance.now() - startedAt),
    });

    const outcome = snap.context.outcome ?? undefined;
    return {
      reply,
      shouldHangup,
      state: nextState,
      ...(outcome !== undefined && { outcome }),
      ...(parsed.data.usage !== undefined && { usage: parsed.data.usage }),
    };
  }

  /** LLM streaming destekliyor mu? Orchestrator buna göre yol seçer. */
  get supportsStreaming(): boolean {
    return typeof this.llm.streamReply === 'function';
  }

  async handleUserText(userText: string): Promise<TurnDecision> {
    const startedAt = performance.now();
    this.history.push({ speaker: 'customer', text: userText, at: new Date().toISOString() });

    const state = currentState(this.actor);
    const raw = await this.llm.respond({
      systemPrompt: systemPromptFor(state, this.callContext),
      context: { callContext: this.callContext, state, history: this.history },
      userText,
    });

    const parsed = LLMStructuredOutputSchema.safeParse(raw);
    if (!parsed.success) {
      logger.warn(
        { issues: parsed.error.issues, callId: this.callContext.callId },
        'llm output invalid',
      );
      const reply = 'Sizi tam anlayamadım, kısaca tekrar eder misiniz?';
      this.recordAgentUtterance(reply);
      return { reply, shouldHangup: false, state };
    }

    const { say, intent, fields } = parsed.data;
    const event = eventFromIntent(intent, fields);
    if (event) this.actor.send(event);

    const snap = this.actor.getSnapshot();
    const nextState = snap.value as ConversationState;
    const shouldHangup = snap.status === 'done';

    this.history.push({
      speaker: 'agent',
      text: say,
      at: new Date().toISOString(),
      latencyMs: Math.round(performance.now() - startedAt),
    });

    const outcome = snap.context.outcome ?? undefined;
    return {
      reply: say,
      shouldHangup,
      state: nextState,
      ...(outcome !== undefined && { outcome }),
      ...(parsed.data.usage !== undefined && { usage: parsed.data.usage }),
    };
  }
}
