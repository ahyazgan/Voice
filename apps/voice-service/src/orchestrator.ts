import type {
  AudioChunk,
  CallContext,
  ILLMProvider,
  ISTTProvider,
  ITTSProvider,
  TelephonySession,
} from '@voice/shared';
import { normalizeForTTS } from '@voice/shared';
import { CallTelemetry, logger } from './telemetry.js';
import { getCostRates, env } from './config.js';
import { isBackchannel } from './backchannel.js';
import { TurnHandler, type TurnDecision } from './turnHandler.js';
import { CONSENT_ANNOUNCEMENT } from './prompts/index.js';
import { postFinalize } from './persist.js';

export interface OrchestratorDeps {
  stt: ISTTProvider;
  tts: ITTSProvider;
  llm: ILLMProvider;
}

export interface OrchestratorOptions {
  callContext: CallContext;
  session: TelephonySession;
  sampleRate: number;
  /** Arama bittiğinde (finalize + hangup sonrası) tetiklenir. Server WS'i kapatmak için. */
  onShutdown?: (reason: string) => void;
}

/**
 * Faz 2 orkestratörü: STT/LLM/TTS sağlayıcılarını doğrudan akıt.
 * Barge-in: STT 'partial' eventinde devam eden TTS hemen kesilir.
 * Hedef gecikme: müşteri sustuktan AI ilk sese ~550ms (tavan 800ms).
 */
export class Orchestrator {
  private turn: TurnHandler;
  private telemetry: CallTelemetry;
  private sttSession;
  private ttsPlayback: { stop: () => void } | null = null;
  /** Bu turda ilk partial geldi mi — caller_speaking'i tek kez işaretlemek için. */
  private turnOpen = false;
  /** Müşteri AI'ı kesti mi — streaming turda kalan cümleleri atlamak için. */
  private interrupted = false;
  /** AI şu an konuşuyor mu — backchannel filtresi bunun için. */
  private speaking = false;
  /** Sessizlik dürtme sayacı + kaç kez dürtüldü (2. sessizlikte kapat). */
  private silenceTimer: NodeJS.Timeout | null = null;
  private silencePrompts = 0;

  constructor(
    private readonly deps: OrchestratorDeps,
    private readonly opts: OrchestratorOptions,
  ) {
    this.turn = new TurnHandler(opts.callContext, deps.llm);
    this.telemetry = new CallTelemetry(opts.callContext.callId, getCostRates());
    this.sttSession = deps.stt.createSession({
      sampleRate: opts.sampleRate,
      language: 'tr-TR',
    });

    opts.session.onAudio((chunk: AudioChunk) => this.sttSession.push(chunk));
    opts.session.onHangup(() => void this.shutdown('hangup'));

    this.sttSession.onEvent((evt) => {
      if (evt.type === 'partial') {
        // Tur başlangıcı: müşteri konuşmaya başladı. KPI penceresinin (caller→
        // ilk-AI-sesi) başlangıcı burası. Tur içinde yalnızca İLK partial'da.
        if (!this.turnOpen) {
          this.turnOpen = true;
          this.telemetry.mark('caller_speaking');
        }
        if (this.ttsPlayback) {
          // barge-in: ZORUNLU. <200ms hedef.
          // 1) Bizim TTS stream'imizi kes — yeni paket göndermeyi durdur.
          // 2) Telefon kuyruğundaki ÇALMAMIŞ paketleri sil. Bu olmazsa müşteri
          //    konuşurken AI'ın 1-2 saniyelik buffer'ı çalmaya devam eder.
          this.ttsPlayback.stop();
          this.opts.session.stopPlayback();
          this.ttsPlayback = null;
          this.interrupted = true; // streaming turda kalan cümleleri atla
          this.telemetry.mark('barge_in');
        }
      }
      if (evt.type === 'final') {
        // Backchannel filtresi: AI konuşurken gelen kısa onay ("hı hı", "tamam")
        // tur DEĞİLDİR — insan da dinlerken bunlarla kesilmez. Yok say, devam et.
        if (this.speaking && isBackchannel(evt.text)) {
          this.interrupted = false; // yanlış barge-in'i geri al (AI konuşmaya devam)
          return;
        }
        this.telemetry.mark('stt_final');
        this.turnOpen = false; // tur kapandı, sonraki partial yeni turu açar
        this.interrupted = false; // yeni tur: kesinti bayrağını sıfırla
        // Maliyet: STT bu turda kaç saniye ses işledi. Düşersek sttSec=0 raporlanır.
        this.telemetry.addSttSeconds(evt.durationMs / 1000);
        this.silencePrompts = 0; // müşteri konuştu → sessizlik sayacını sıfırla
        void this.onUserTurn(evt.text);
      }
    });
  }

  async start(): Promise<void> {
    await this.speak(CONSENT_ANNOUNCEMENT, { trackTurn: false });
    this.armSilenceTimer(); // anons bitti; müşteri konuşmazsa dürt
  }

  private async onUserTurn(userText: string): Promise<void> {
    try {
      const decision = this.turn.supportsStreaming
        ? await this.streamingTurn(userText)
        : await this.blockingTurn(userText);
      this.telemetry.endTurn();

      if (decision.shouldHangup) {
        await this.shutdown(`state_terminal:${decision.outcome ?? 'unknown'}`);
      } else {
        // AI sustu, sıra müşteride. Cevap gelmezse SILENCE_PROMPT_MS sonra dürt.
        this.armSilenceTimer();
      }
    } catch (err) {
      logger.error({ err, callId: this.opts.callContext.callId }, 'turn failed');
      await this.speak('Şu an bir aksaklık var, sizi sonra tekrar arayacağız.', {
        trackTurn: false,
      });
      this.telemetry.endTurn();
      await this.shutdown('error');
    }
  }

  /** Streaming yol: ilk cümle geldiği an TTS'e basılır → gecikme düşer (insan gibi). */
  private async streamingTurn(userText: string): Promise<TurnDecision> {
    const gen = this.turn.handleUserTextStreaming(userText);
    let first = true;
    let next = await gen.next();
    while (!next.done) {
      if (first) {
        this.telemetry.markOnce('llm_first_token'); // ilk cümle = ilk anlamlı token
        first = false;
      }
      // Müşteri kestiyse kalan cümleleri SESLENDİRME (insan da kesilince susar),
      // ama generator'ı tüket ki state machine ilerlesin ve decision dönsün.
      if (!this.interrupted) {
        await this.speak(next.value, { trackTurn: true });
      }
      next = await gen.next();
    }
    const decision = next.value;
    if (decision.usage) this.telemetry.addLlmTokens(decision.usage.tokensIn, decision.usage.tokensOut);
    return decision;
  }

  /** Streaming desteklenmeyen sağlayıcılar: tüm yanıtı bekle, sonra konuş. */
  private async blockingTurn(userText: string): Promise<TurnDecision> {
    const decision = await this.turn.handleUserText(userText);
    this.telemetry.markOnce('llm_first_token');
    if (decision.usage) this.telemetry.addLlmTokens(decision.usage.tokensIn, decision.usage.tokensOut);
    await this.speak(decision.reply, { trackTurn: true });
    return decision;
  }

  private async speak(text: string, opts: { trackTurn: boolean }): Promise<void> {
    let stopped = false;
    this.ttsPlayback = { stop: () => (stopped = true) };
    this.speaking = true;
    this.clearSilenceTimer(); // AI konuşurken sessizlik dürtmesi anlamsız

    // Sayı/tarih/para'yı insan okunuşuna çevir (TTS doğal okusun). History ve
    // maliyet ham metni kullanır; yalnızca SES bu normalize metni okur.
    const spoken = normalizeForTTS(text);
    const stream = this.deps.tts.synthesizeStream(spoken, {
      voice: 'tr-default',
      sampleRate: this.opts.sampleRate,
      language: 'tr-TR',
    });

    let first = true;
    for await (const chunk of stream) {
      if (stopped) break;
      if (first) {
        if (opts.trackTurn) this.telemetry.markOnce('tts_first_chunk');
        first = false;
      }
      this.opts.session.sendAudio(chunk);
    }

    this.telemetry.addTtsChars(text.length);
    this.ttsPlayback = null;
    this.speaking = false;
    if (!opts.trackTurn) {
      // CONSENT_ANNOUNCEMENT / hata mesajı gibi: history'ye agent ifadesi olarak yaz.
      this.turn.recordAgentUtterance(text);
    }
  }

  // --- Sessizlik yönetimi: müşteri cevap vermezse dürt, sonra kapat ----------
  private armSilenceTimer(): void {
    this.clearSilenceTimer();
    this.silenceTimer = setTimeout(() => void this.onSilence(), env.SILENCE_PROMPT_MS);
  }

  private clearSilenceTimer(): void {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
  }

  /** Sessizlik süresi doldu: 1. kez nazikçe dürt, 2. kez kapat (sonsuz bekleme yok). */
  private async onSilence(): Promise<void> {
    if (this.shuttingDown || this.speaking) return;
    this.silencePrompts++;
    if (this.silencePrompts >= 2) {
      await this.speak('Şu an ulaşamıyorum, sizi sonra tekrar arayalım. İyi günler.', {
        trackTurn: false,
      });
      await this.shutdown('silence');
      return;
    }
    await this.speak('Alo, orada mısınız?', { trackTurn: false });
    this.armSilenceTimer(); // tekrar bekle; yine sessizse kapanır
  }

  private shuttingDown = false;

  async shutdown(reason: string): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    this.clearSilenceTimer();

    const summary = this.telemetry.finalize();
    const outcome = this.turn.outcome ?? 'NO_ANSWER';
    logger.info(
      { reason, callId: this.opts.callContext.callId, outcome, summary },
      'orchestrator shutdown',
    );

    await Promise.allSettled([
      this.sttSession.close(),
      this.opts.session.hangup(reason),
      postFinalize({
        callId: this.opts.callContext.callId,
        outcome,
        consentToRecord: this.opts.callContext.consentToRecord,
        ...(this.turn.promisedAmount !== undefined && { promisedAmount: this.turn.promisedAmount }),
        ...(this.turn.promisedDate !== undefined && { promisedDate: this.turn.promisedDate }),
        ...(this.turn.callbackAt !== undefined && { callbackAt: this.turn.callbackAt }),
        ...(this.turn.disputeReason !== undefined && { disputeReason: this.turn.disputeReason }),
        summary,
        transcript: this.turn.transcript,
      }),
    ]);

    this.opts.onShutdown?.(reason);
  }

  getSnapshot() {
    return {
      transcript: this.turn.transcript,
      outcome: this.turn.outcome,
    };
  }
}
