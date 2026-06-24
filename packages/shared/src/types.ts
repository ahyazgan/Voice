export type CallOutcome =
  | 'PROMISE_TO_PAY'
  | 'DISPUTE'
  | 'WRONG_NUMBER'
  | 'NO_ANSWER'
  | 'CALLBACK_REQUESTED'
  | 'ESCALATED_TO_HUMAN'
  | 'REFUSED';

export interface Debtor {
  id: string;
  fullName: string;
  phoneE164: string;
  amountDue: number;
  currency: 'TRY';
  dueDate: string;
  invoiceRef?: string;
}

export type TurnSpeaker = 'agent' | 'customer' | 'system';

export interface TranscriptTurn {
  speaker: TurnSpeaker;
  text: string;
  at: string;
  latencyMs?: number;
}

export interface CostBreakdown {
  telephonySec: number;
  sttSec: number;
  llmTokensIn: number;
  llmTokensOut: number;
  ttsChars: number;
  totalTRY: number;
}

export interface CallResult {
  callId: string;
  debtorId: string;
  outcome: CallOutcome;
  promisedAmount?: number;
  promisedDate?: string;
  transcript: TranscriptTurn[];
  recordingUrl?: string;
  durationSec: number;
  costBreakdown: CostBreakdown;
  startedAt: string;
}

export type ConversationState =
  | 'greeting'
  | 'identify'
  | 'remind'
  | 'negotiate'
  | 'confirm'
  | 'escalate'
  | 'closing';

/**
 * Önceki aramanın özeti — "cross-call memory". Aynı borçluyla ikinci kez
 * görüşülürken AI'ın doğal bir şekilde geçmişe değinmesi için (insan unutmaz):
 * "geçen hafta 15'inde ödeme yapacağınızı konuşmuştuk". API, borçlunun son
 * tamamlanmış aramasından doldurur; voice-service yalnızca TÜKETİR (prompt'a işler).
 */
export interface PriorCallSummary {
  /** Son aramanın tarihi (ISO). */
  at: string;
  outcome: CallOutcome;
  /** O aramada alınan ödeme sözü tutarı (kuruş), varsa. */
  promisedAmount?: number;
  /** O aramada alınan ödeme sözü tarihi (ISO), varsa. */
  promisedDate?: string;
}

export interface CallContext {
  callId: string;
  debtor: Debtor;
  startedAt: string;
  consentToRecord: boolean;
  /** Bu borçluyla önceki görüşmenin özeti (varsa). Doğal "hatırlama" için. */
  priorCall?: PriorCallSummary;
}

/**
 * LLM'in üretebileceği intent kümesi. Durum makinesindeki eventlerle birebir eşleşir.
 * "UNCLEAR" KASTEN YOK — belirsizlik NO_RESPONSE ile ifade edilir; LLM her zaman
 * bu kümeden birini seçmek ZORUNDA (yapılandırılmış çıktı kontratı).
 */
export type LLMIntent =
  | 'IDENTITY_CONFIRMED'
  | 'WRONG_PERSON'
  | 'WILL_PAY'           // tam ödeme sözü (extracted: promisedAmount, promisedDate)
  | 'PARTIAL_OR_PLAN'    // taksit / kısmi (extracted: promisedAmount, promisedDate)
  | 'DISPUTES_DEBT'      // borca itiraz (extracted: disputeReason)
  | 'REFUSES'
  | 'ASKS_CALLBACK'      // (extracted: callbackAt)
  | 'GETS_ANGRY'
  | 'CONFIRMED'
  | 'CONSENT_DECLINED'   // KVKK: arama kaydını reddetti → recordingConsent=false
  | 'NO_RESPONSE';

/**
 * LLM yapılandırılmış çıktısı. Provider'ın JSON-mode / tool-call ile dayatacağı şema.
 *   - say: TTS'e gidecek Türkçe metin (kısa, doğal, telefon kalitesinde)
 *   - intent: durum makinesini ilerleten olay tipi (kapalı liste)
 *   - fields: amount(kuruş) / date(ISO; YYYY-MM-DD veya tam) / reason
 *     ASKS_CALLBACK için `date` = geri arama tarihi.
 */
export interface LLMStructuredOutput {
  say: string;
  intent: LLMIntent;
  fields?: {
    amount?: number;   // kuruş (float YOK)
    date?: string;     // YYYY-MM-DD veya tam ISO
    reason?: string;
  };
  /**
   * Token kullanımı (maliyet telemetrisi için). Şemanın parçası DEĞİL — provider
   * ekler, TurnHandler telemetriye taşır. Sağlayıcı vermezse undefined.
   */
  usage?: {
    tokensIn: number;
    tokensOut: number;
  };
}

export interface AudioChunk {
  data: Uint8Array;
  sampleRate: number;
  /** pcm16 (linear), mulaw/pcmu (G.711 μ-law, eş anlamlı), opus. */
  encoding: 'pcm16' | 'mulaw' | 'pcmu' | 'opus';
  /** Arama başlangıcına göre ms (jitter hesabı için). */
  timestampMs?: number;
}
