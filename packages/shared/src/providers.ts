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

/**
 * Tek bir seslendirme için TTS ses ayarı override'ı. Orchestrator konuşma
 * durumuna göre tonu ayarlar (empati=sıcak, teyit=net); sağlayıcı bunları
 * config TABAN değerinin üzerine uygular. Verilmeyen alan config'ten gelir.
 */
export interface TTSVoiceSettings {
  stability?: number;
  similarityBoost?: number;
  style?: number;
  useSpeakerBoost?: boolean;
}

export interface TTSOptions {
  voice: string;
  sampleRate: number;
  language: 'tr-TR';
  /** Bu seslendirmeye özel ton override'ı (durum-bazlı). Yoksa config varsayılanı. */
  voiceSettings?: TTSVoiceSettings;
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

export interface PlatformCallOptions {
  callContext: CallContext;
  onTurn: (input: PlatformTurnInput) => Promise<PlatformTurnDecision>;
  onEnd?: (info: { reason: string; transcript: TranscriptTurn[]; outcome?: CallOutcome }) => void;
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
