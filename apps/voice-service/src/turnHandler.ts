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
/**
 * Art arda kaç LLM parse hatasından sonra aramayı güvenli kapatırız. Tek seferlik
 * bozuk çıktı normaldir (state'te kalıp tekrar sorarız); ama LLM üst üste geçersiz
 * üretiyorsa müşteri aynı turda SONSUZA DEK sıkışır — bu eşikte escalate edip kapat.
 */
const MAX_CONSECUTIVE_PARSE_FAILURES = 3;

export class TurnHandler {
  private actor: ConversationActor;
  private history: TranscriptTurn[] = [];
  /** Art arda LLM parse hatası sayacı; başarılı turda sıfırlanır. */
  private consecutiveParseFailures = 0;

  constructor(
    private readonly callContext: CallContext,
    private readonly llm: ILLMProvider,
  ) {
    this.actor = startConversation(callContext.debtor);
  }

  /**
   * Parse hatası ortak ele alımı. Sayaç eşiği aşılırsa aramayı güvenli sonlandırır
   * (shouldHangup + ESCALATED_TO_HUMAN) — sonsuz döngü engellenir. Eşiğin altında
   * eski davranış: state'te kal, kısaca tekrar sor (shouldHangup=false).
   */
  private handleParseFailure(state: ConversationState, fallbackReply: string): TurnDecision {
    this.consecutiveParseFailures += 1;
    if (this.consecutiveParseFailures >= MAX_CONSECUTIVE_PARSE_FAILURES) {
      logger.error(
        { callId: this.callContext.callId, failures: this.consecutiveParseFailures },
        'llm art arda parse hatası eşiği aşıldı; arama güvenli kapatılıyor',
      );
      const reply = 'Sizi şu an net anlayamıyorum, bir yetkilimiz sizinle tekrar görüşecek. İyi günler.';
      this.recordAgentUtterance(reply);
      return { reply, shouldHangup: true, outcome: 'ESCALATED_TO_HUMAN', state };
    }
    this.recordAgentUtterance(fallbackReply);
    return { reply: fallbackReply, shouldHangup: false, state };
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

  /** Müşterinin belirttiği ödeme yöntemi (varsa) — Payment.method'a taşınır. */
  get paymentMethod(): 'BANK_TRANSFER' | 'CASH' | 'CARD' | 'INSTALLMENT' | undefined {
    return this.actor.getSnapshot().context.paymentMethod ?? undefined;
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
      // Stream'de zaten cümle yield edildiyse onu reply yap; yoksa kısa tekrar isteği.
      const fallback = sentences.join(' ') || 'Sizi tam anlayamadım, tekrar eder misiniz?';
      return this.handleParseFailure(state, fallback);
    }
    this.consecutiveParseFailures = 0;

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
      return this.handleParseFailure(state, 'Sizi tam anlayamadım, kısaca tekrar eder misiniz?');
    }
    this.consecutiveParseFailures = 0;

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
