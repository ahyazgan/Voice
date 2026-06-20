import type {
  AudioChunk,
  CallContext,
  CallOutcome,
  ConversationState,
  LLMStructuredOutput,
  TranscriptTurn,
} from './types.js';

// ---------- Telephony ----------

export interface PlaceCallOptions {
  to: string;
  from: string;
  callId: string;
}

export interface TelephonySession {
  readonly callId: string;
  onAudio(handler: (chunk: AudioChunk) => void): void;
  onHangup(handler: () => void): void;
  sendAudio(chunk: AudioChunk): void;
  /**
   * BARGE-IN: hatta gönderilmiş ama henüz çalınmamış sesi ANINDA boşalt.
   * <200ms hedef. Sadece bizim TTS stream'imizi kesmek YETMEZ — telefon
   * sağlayıcısının kuyruğundaki paketler çalmaya devam eder.
   * Telnyx: `clear` media event. Twilio: `clear` Media Streams komutu.
   */
  stopPlayback(): void;
  hangup(reason?: string): Promise<void>;
}

export interface ITelephonyProvider {
  readonly name: string;
  placeCall(opts: PlaceCallOptions): Promise<TelephonySession>;
}

// ---------- STT ----------

export interface STTOptions {
  sampleRate: number;
  language: 'tr-TR';
}

export type STTEvent =
  | { type: 'partial'; text: string }
  | { type: 'final'; text: string; durationMs: number };

export interface STTSession {
  push(chunk: AudioChunk): void;
  onEvent(handler: (evt: STTEvent) => void): void;
  close(): Promise<void>;
}

export interface ISTTProvider {
  readonly name: string;
  createSession(opts: STTOptions): STTSession;
}

// ---------- TTS ----------

export interface TTSOptions {
  voice: string;
  sampleRate: number;
  language: 'tr-TR';
}

export interface ITTSProvider {
  readonly name: string;
  synthesizeStream(text: string, opts: TTSOptions): AsyncIterable<AudioChunk>;
}

// ---------- LLM ----------

export interface LLMRequest {
  systemPrompt: string;
  context: {
    callContext: CallContext;
    state: ConversationState;
    history: TranscriptTurn[];
  };
  userText: string;
}

/**
 * Streaming sonucu: `say` metni CÜMLE CÜMLE akar (yield), JSON tamamlanınca tam
 * yapılandırılmış çıktı (intent + fields + usage) dönüş değeri olur. Orchestrator
 * cümleleri hemen TTS'e basar (gecikme düşer), intent'i sonda state machine'e verir.
 */
export type StructuredStream = AsyncGenerator<string, LLMStructuredOutput, void>;

export interface ILLMProvider {
  readonly name: string;
  /** Tek seferde tam yapılandırılmış çıktı döner (streaming desteklemeyen yollar için). */
  respond(req: LLMRequest): Promise<LLMStructuredOutput>;
  /**
   * `say` cümlelerini akıtır, dönüşte tam yapılandırılmış çıktıyı verir.
   * Destekleyen sağlayıcı implemente eder; yoksa orchestrator respond()'a düşer.
   */
  streamReply?(req: LLMRequest): StructuredStream;
}

// ---------- Orkestrasyon Platformu (Faz 1: Retell / Vapi) ----------
//
// Faz 1'de telefon + STT + TTS + LLM çağrısı platform tarafından yürütülür.
// Bizim katkımız her tur (turn) için: state machine + tahsilat iş mantığı +
// yapılandırılmış çıktı. Platform her müşteri turu için `onTurn` çağırır,
// biz reply + state bilgisi döneriz; platform reply'i seslendirip telefona basar.
//
// Faz 2 (kendi cascade) bu interface'i kullanmaz — `Orchestrator` doğrudan
// STT/LLM/TTS sağlayıcılarını yönetir. İki modda da aynı `TurnHandler` çalışır.

export interface PlatformTurnInput {
  userText: string;
  turnIndex: number;
}

export interface PlatformTurnDecision {
  reply: string;
  state: ConversationState;
  shouldHangup: boolean;
  outcome?: CallOutcome;
}

/**
 * Platform arama sonu bilgisi. Faz 1'de ses/STT/TTS maliyeti platformdadır;
 * platform `call_ended` olayında gerçek süreyi ve (sağlıyorsa) toplam maliyeti
 * verir. Bunlar finalize'a taşınır → Faz 1'de de costTRY dolar (sonuç-bazlı
 * fiyatlandırmanın temeli). Vermeyen platformda alanlar undefined kalır.
 */
export interface PlatformEndInfo {
  reason: string;
  transcript: TranscriptTurn[];
  outcome?: CallOutcome;
  /** Platformun raporladığı gerçek konuşma süresi (sn). */
  durationSec?: number;
  /** Platformun raporladığı toplam arama maliyeti (TRY). LLM maliyeti buna dahil olabilir. */
  platformCostTRY?: number;
  /**
   * Platformun ses kaydı URL'si (Faz 1: kayıt platformda tutulur). KVKK: yalnızca
   * rıza varsa finalize'a taşınır (persist.ts süzer). Saklama süresi dolunca silinir.
   */
  recordingUrl?: string;
}

export interface PlatformCallOptions {
  callContext: CallContext;
  onTurn: (input: PlatformTurnInput) => Promise<PlatformTurnDecision>;
  onEnd?: (info: PlatformEndInfo) => void;
  /** Açılış cümlesi (KVKK rıza anonsu vb.). Platform müşteri konuşmadan önce seslendirir. */
  openingUtterance: string;
}

export interface PlatformCallSession {
  readonly callId: string;
  end(reason?: string): Promise<void>;
}

export interface IOrchestrationPlatform {
  readonly name: string;
  startCall(opts: PlatformCallOptions): Promise<PlatformCallSession>;
}

// ---------- Ses Kaydı Deposu (Faz 2: kayıt bizde) ----------
//
// Faz 1'de kayıt platformda tutulur (PlatformEndInfo.recordingUrl). Faz 2'de ses
// bizden aktığı için kaydı KENDİMİZ saklarız: put() ile yükle, URL'yi finalize'a
// koy; KVKK saklama süresi dolunca delete() ile sil. S3/GCS/yerel disk ardına alınır.

export interface RecordingStorePutOptions {
  callId: string;
  /** İçerik türü (örn. 'audio/wav', 'audio/mpeg'). */
  contentType: string;
}

export interface IRecordingStore {
  readonly name: string;
  /** Kayıt baytlarını saklar, erişilebilir/erişilebilir-yapılabilir URL döner. */
  put(data: Uint8Array, opts: RecordingStorePutOptions): Promise<string>;
  /** Saklama süresi dolan kaydı kalıcı siler. URL bilinmiyorsa/yoksa no-op. */
  delete(url: string): Promise<void>;
}
