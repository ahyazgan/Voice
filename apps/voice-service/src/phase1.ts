import type {
  CallContext,
  ILLMProvider,
  IOrchestrationPlatform,
  PlatformCallSession,
} from '@voice/shared';
import { normalizeForTTS } from '@voice/shared';
import { TurnHandler } from './turnHandler.js';
import { CONSENT_ANNOUNCEMENT } from './prompts/index.js';
import { CallTelemetry, logger } from './telemetry.js';
import { getCostRates } from './config.js';
import { postFinalize } from './persist.js';

/**
 * Faz 1 köprüsü: orkestrasyon platformu (Retell/Vapi vb.) üstünde aramayı başlatır.
 * Platform ses/STT/TTS'yi yürütür; biz her tur için TurnHandler ile yapılandırılmış
 * cevap döneriz.
 *
 * Telemetri: Faz 1'de TTS first chunk'a erişimimiz YOK (platform akışın içinde).
 * Bu yüzden sadece LLM gecikmesi anlamlı: stt_final (onTurn girişi) → llm_first_token
 * (LLM respond döndü). responseLatency hesaplanmaz; KPI uyarısı tetiklenmez.
 */
export async function startPlatformCall(deps: {
  platform: IOrchestrationPlatform;
  llm: ILLMProvider;
  callContext: CallContext;
  /** Arama bittiğinde tetiklenir; server kontrol WS'ini buradan kapatır. */
  onComplete?: (reason: string) => void;
}): Promise<PlatformCallSession> {
  const turn = new TurnHandler(deps.callContext, deps.llm);
  const telemetry = new CallTelemetry(deps.callContext.callId, getCostRates());

  const session = await deps.platform.startCall({
    callContext: deps.callContext,
    openingUtterance: CONSENT_ANNOUNCEMENT,
    onTurn: async ({ userText, turnIndex }) => {
      telemetry.mark('stt_final');
      const decision = await turn.handleUserText(userText);
      telemetry.markOnce('llm_first_token');
      if (decision.usage) {
        telemetry.addLlmTokens(decision.usage.tokensIn, decision.usage.tokensOut);
      }
      telemetry.endTurn();

      logger.info(
        {
          callId: deps.callContext.callId,
          turnIndex,
          state: decision.state,
          shouldHangup: decision.shouldHangup,
        },
        'phase1 turn',
      );
      return {
        // Faz 1'de TTS platformda; platforma giden metni de normalize et
        // (sayı/tarih insan okunuşu) — transcript ham decision.reply'ı korur.
        reply: normalizeForTTS(decision.reply),
        state: decision.state,
        shouldHangup: decision.shouldHangup,
        ...(decision.outcome !== undefined && { outcome: decision.outcome }),
      };
    },
    onEnd: ({ reason, outcome }) => {
      const summary = telemetry.finalize();
      const finalOutcome = outcome ?? turn.outcome ?? 'NO_ANSWER';
      logger.info(
        {
          callId: deps.callContext.callId,
          reason,
          outcome: finalOutcome,
          turns: turn.transcript.length,
          summary,
        },
        'phase1 call ended',
      );
      void postFinalize({
        callId: deps.callContext.callId,
        outcome: finalOutcome,
        consentToRecord: deps.callContext.consentToRecord,
        ...(turn.promisedAmount !== undefined && { promisedAmount: turn.promisedAmount }),
        ...(turn.promisedDate !== undefined && { promisedDate: turn.promisedDate }),
        ...(turn.callbackAt !== undefined && { callbackAt: turn.callbackAt }),
        ...(turn.disputeReason !== undefined && { disputeReason: turn.disputeReason }),
        summary,
        transcript: turn.transcript,
      });
      deps.onComplete?.(reason);
    },
  });

  return session;
}
