import type {
  AudioChunk,
  CallContext,
  ILLMProvider,
  ISTTProvider,
  ITTSProvider,
  TelephonySession,
} from '@voice/shared';
import { CallTelemetry, logger } from './telemetry.js';
import { getCostRates } from './config.js';
import { TurnHandler } from './turnHandler.js';
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
      if (evt.type === 'partial' && this.ttsPlayback) {
        // barge-in: ZORUNLU. <200ms hedef.
        // 1) Bizim TTS stream'imizi kes — yeni paket göndermeyi durdur.
        // 2) Telefon kuyruğundaki ÇALMAMIŞ paketleri sil. Bu olmazsa müşteri
        //    konuşurken AI'ın 1-2 saniyelik buffer'ı çalmaya devam eder.
        this.ttsPlayback.stop();
        this.opts.session.stopPlayback();
        this.ttsPlayback = null;
        this.telemetry.mark('barge_in');
      }
      if (evt.type === 'final') {
        this.telemetry.mark('stt_final');
        void this.onUserTurn(evt.text);
      }
    });
  }

  async start(): Promise<void> {
    await this.speak(CONSENT_ANNOUNCEMENT, { trackTurn: false });
  }

  private async onUserTurn(userText: string): Promise<void> {
    try {
      const decision = await this.turn.handleUserText(userText);
      // LLM streaming yok; respond() döndüğü an "ilk token = tam yanıt" sayıyoruz.
      this.telemetry.markOnce('llm_first_token');
      await this.speak(decision.reply, { trackTurn: true });
      this.telemetry.endTurn();

      if (decision.shouldHangup) {
        await this.shutdown(`state_terminal:${decision.outcome ?? 'unknown'}`);
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

  private async speak(text: string, opts: { trackTurn: boolean }): Promise<void> {
    let stopped = false;
    this.ttsPlayback = { stop: () => (stopped = true) };

    const stream = this.deps.tts.synthesizeStream(text, {
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
    if (!opts.trackTurn) {
      // CONSENT_ANNOUNCEMENT / hata mesajı gibi: history'ye agent ifadesi olarak yaz.
      this.turn.recordAgentUtterance(text);
    }
  }

  private shuttingDown = false;

  async shutdown(reason: string): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;

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
