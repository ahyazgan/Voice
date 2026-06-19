// =============================================================================
// providers/platform/retell.ts — IOrchestrationPlatform (Retell AI, Faz 1)
// =============================================================================
// Retell telefon + STT + TTS + turn-taking + barge-in'i KENDİ yürütür. Bizim
// iş mantığımıza (state machine + tahsilat senaryosu) "Custom LLM" modu ile
// ulaşır: Retell, agent'a tanımlı llm_websocket_url'e bir WS açar ve her müşteri
// turunda bize `response_required` yollar; biz TurnHandler'ı çalıştırıp düz metin
// reply döneriz. Retell reply'i seslendirip telefona basar.
//
// MİMARİ KÖPRÜ (kritik):
//   IOrchestrationPlatform.startCall() GİDEN bir REST çağrısıdır (aramayı başlat).
//   Ama turlar GELEN bir WS'ten gelir (Retell → bizim sunucu). Bu iki yönü
//   `callId` ile bir registry üzerinden bağlarız:
//     1) startCall() → POST /v2/create-phone-call → call_id al, registry'e
//        PlatformCallOptions'ı (onTurn/onEnd) yaz, session döndür.
//     2) Retell WS açar → server.ts handleRetellWebSocket(ws, callId) çağırır →
//        registry'den options bulunur, WS o oturuma pipe edilir.
//
// Bu dosya SDK'ya bağlı değil; fetch + ws ile konuşur (telnyx.ts ile aynı kalıp).
// Retell Custom-LLM protokolü: https://docs.retellai.com/api-references/llm-websocket
// =============================================================================

import type { WebSocket } from 'ws';
import type {
  IOrchestrationPlatform,
  PlatformCallOptions,
  PlatformCallSession,
  PlatformTurnDecision,
  TranscriptTurn,
} from '@voice/shared';
import { maskPhone } from '@voice/shared';
import { logger } from '../../telemetry.js';

export interface RetellConfig {
  apiKey: string;
  agentId: string;
  fromNumberE164: string;
}

// --- callId → bekleyen oturum kaydı -----------------------------------------
// startCall() yazar, handleRetellWebSocket() okur. Gelen WS'in startCall'dan
// önce gelmesi imkânsız (Retell önce REST'e cevap verir), ama yine de WS biraz
// erken gelirse kısa bir grace window ile bekleriz (aşağıda).
interface PendingCall {
  options: PlatformCallOptions;
  session: RetellCallSession;
  /** WS bağlanınca çözülür; handleRetellWebSocket bunu await eder. */
  resolveAttached?: () => void;
}

const registry = new Map<string, PendingCall>();

// --- Retell WS mesaj tipleri (kullandığımız alt küme) -----------------------
interface RetellTranscriptUtterance {
  role: 'agent' | 'user';
  content: string;
}

interface RetellInboundEvent {
  // 'response_required' = yeni kullanıcı turu, cevap bekleniyor
  // 'reminder_required' = kullanıcı sustu, dürtme cevabı bekleniyor
  // 'ping_pong'         = keepalive
  // 'update_only'       = transcript güncellemesi, cevap beklenmiyor
  interaction_type:
    | 'response_required'
    | 'reminder_required'
    | 'ping_pong'
    | 'update_only'
    | 'call_details';
  response_id?: number;
  transcript?: RetellTranscriptUtterance[];
  timestamp?: number;
}

interface RetellOutboundResponse {
  response_type: 'response';
  response_id: number;
  content: string;
  content_complete: true;
  end_call?: boolean;
}

export class RetellOrchestrationPlatform implements IOrchestrationPlatform {
  readonly name = 'retell';

  constructor(private readonly cfg: RetellConfig) {}

  async startCall(opts: PlatformCallOptions): Promise<PlatformCallSession> {
    const { debtor } = opts.callContext;

    const res = await fetch('https://api.retellai.com/v2/create-phone-call', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.cfg.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from_number: this.cfg.fromNumberE164,
        to_number: debtor.phoneE164,
        override_agent_id: this.cfg.agentId,
        // Retell metadata'yı call objesinde ve WS call_details'te geri verir;
        // borçlu bağlamını prompt'a değil, kendi state machine'imize taşırız.
        metadata: { callId: opts.callContext.callId, debtorId: debtor.id },
        // Açılış cümlesi (KVKK rıza anonsu): Retell agent'ı müşteri konuşmadan
        // önce seslendirsin. Agent config'inde begin_message boş bırakılmalı ki
        // buradaki dinamik değer kazansın.
        retell_llm_dynamic_variables: {
          opening_utterance: opts.openingUtterance,
          debtor_name: debtor.fullName,
        },
      }),
    });

    if (!res.ok) {
      throw new Error(`Retell create-phone-call başarısız: ${res.status} ${await res.text()}`);
    }

    const json = (await res.json()) as { call_id: string };
    const retellCallId = json.call_id;

    const session = new RetellCallSession(
      this.cfg,
      opts.callContext.callId,
      retellCallId,
    );

    registry.set(opts.callContext.callId, { options: opts, session });
    logger.info(
      // KVKK: telefon numarası PII — log'a maskeli yaz (son 4 hane).
      { callId: opts.callContext.callId, retellCallId, toMasked: maskPhone(debtor.phoneE164) },
      'retell call placed; awaiting llm websocket; rıza anonsu opening_utterance ile gönderildi',
    );

    return session;
  }
}

// --- Tek aktif aramanın oturumu ---------------------------------------------
class RetellCallSession implements PlatformCallSession {
  private ws: WebSocket | null = null;
  private ended = false;

  constructor(
    private readonly cfg: RetellConfig,
    readonly callId: string,
    private readonly retellCallId: string,
  ) {}

  /** handleRetellWebSocket WS'i bağladığında çağrılır. */
  attachWebSocket(ws: WebSocket): void {
    this.ws = ws;
  }

  async end(reason?: string): Promise<void> {
    if (this.ended) return;
    this.ended = true;
    registry.delete(this.callId);

    // Retell tarafındaki aramayı da kapat (state terminal'e ulaştıysa zaten
    // end_call ile kapanıyor; bu güvenlik için — örn. WS error'da).
    // Timeout ŞART: Retell API yavaşlarsa bu await orchestrator.shutdown'ı
    // (allSettled içinde) ve dolayısıyla worker job'unu askıya alır → Call
    // RUNNING'de asılı kalır. 3sn'de bırak.
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 3_000);
    try {
      await fetch(`https://api.retellai.com/v2/end-call/${this.retellCallId}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.cfg.apiKey}` },
        signal: ac.signal,
      });
    } catch (err) {
      logger.warn({ err, callId: this.callId, reason }, 'retell end-call failed (ignored)');
    } finally {
      clearTimeout(timer);
      try {
        this.ws?.close();
      } catch {
        /* noop */
      }
    }
  }
}

/**
 * Gelen Retell Custom-LLM WebSocket'ini ilgili oturuma pipe eder.
 * server.ts, ws yolundan `call_id`'yi ayıklayıp bunu çağırır.
 *
 * `callId` = bizim CallContext.callId. Retell, llm_websocket_url'e bağlanırken
 * yola kendi call_id'sini koyar; agent'ı kurarken url'i bizim callId'mizi
 * taşıyacak şekilde ayarlamak yerine metadata eşlemesi de kullanılabilir.
 * Burada yolun son segmentinin BİZİM callId olduğunu varsayıyoruz (server.ts
 * start frame'de callId'yi üretip create-phone-call'a verir; Retell aynı
 * call objesi üstünden WS açar — eşleme metadata.callId ile doğrulanır).
 */
export async function handleRetellWebSocket(
  ws: WebSocket,
  callId: string,
  graceMs = 2000,
): Promise<void> {
  // WS, startCall REST'inden hemen sonra gelir; çok kısa bir grace window ile
  // registry'de oturumun belirmesini bekle (yarış koşulu güvencesi).
  const pending = await waitForRegistration(callId, graceMs);
  if (!pending) {
    logger.warn({ callId }, 'retell ws: no matching call session, closing');
    ws.close(1011, 'unknown call');
    return;
  }

  const { options, session } = pending;
  session.attachWebSocket(ws);
  const history: TranscriptTurn[] = [];
  let turnIndex = 0;
  let lastUserContent = '';

  logger.info({ callId }, 'retell llm websocket attached');

  ws.on('message', (raw) => {
    let evt: RetellInboundEvent;
    try {
      evt = JSON.parse(raw.toString()) as RetellInboundEvent;
    } catch {
      return;
    }

    // Keepalive: aynı response_id ile boş response döndürmek yerine yok say —
    // Retell ping_pong'a otomatik devam eder.
    if (evt.interaction_type === 'ping_pong' || evt.interaction_type === 'update_only') {
      return;
    }
    if (evt.interaction_type === 'call_details') {
      return;
    }
    if (evt.response_id === undefined) return;

    const userText = extractLatestUser(evt.transcript);
    // reminder_required'da yeni kullanıcı metni olmayabilir; boşsa NO_RESPONSE
    // dürtmesi için yine de tura sokarız (state machine remind/confirm'de bekler).
    if (evt.interaction_type === 'response_required' && userText && userText !== lastUserContent) {
      lastUserContent = userText;
    }

    void runTurn(evt.response_id, userText);
  });

  ws.on('close', () => {
    logger.info({ callId, turns: turnIndex }, 'retell ws closed');
    options.onEnd?.({ reason: 'ws_closed', transcript: history });
    void session.end('ws_closed');
  });

  ws.on('error', (err) => {
    logger.error({ err, callId }, 'retell ws error');
    void session.end('ws_error');
  });

  async function runTurn(responseId: number, userText: string): Promise<void> {
    let decision: PlatformTurnDecision;
    try {
      decision = await options.onTurn({ userText, turnIndex: turnIndex++ });
    } catch (err) {
      logger.error({ err, callId }, 'retell onTurn failed');
      send(ws, {
        response_type: 'response',
        response_id: responseId,
        content: 'Şu an bir aksaklık var, sizi sonra tekrar arayacağız.',
        content_complete: true,
        end_call: true,
      });
      return;
    }

    history.push({ speaker: 'agent', text: decision.reply, at: new Date().toISOString() });

    send(ws, {
      response_type: 'response',
      response_id: responseId,
      content: decision.reply,
      content_complete: true,
      ...(decision.shouldHangup && { end_call: true }),
    });

    if (decision.shouldHangup) {
      options.onEnd?.({
        reason: `state_terminal:${decision.outcome ?? 'unknown'}`,
        transcript: history,
        ...(decision.outcome !== undefined && { outcome: decision.outcome }),
      });
      // end_call'ı Retell işleyip WS'i kapatacak; registry temizliği session.end'de.
      await session.end('state_terminal');
    }
  }
}

// --- yardımcılar ------------------------------------------------------------

function send(ws: WebSocket, payload: RetellOutboundResponse): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
}

/** Retell transcript'inin son `user` ifadesini döndürür (en güncel kullanıcı turu). */
function extractLatestUser(transcript?: RetellTranscriptUtterance[]): string {
  if (!transcript?.length) return '';
  for (let i = transcript.length - 1; i >= 0; i--) {
    const u = transcript[i];
    if (u?.role === 'user' && u.content.trim()) return u.content.trim();
  }
  return '';
}

/**
 * Registry'de callId belirene kadar kısa süre bekler. startCall REST'i WS'ten
 * önce dönmüş olmalı; bu yalnızca event-loop sırası / mikro yarış güvencesi.
 */
function waitForRegistration(callId: string, timeoutMs: number): Promise<PendingCall | null> {
  const immediate = registry.get(callId);
  if (immediate) return Promise.resolve(immediate);
  if (timeoutMs <= 0) return Promise.resolve(null);

  return new Promise((resolve) => {
    const startedAt = performance.now();
    const tick = (): void => {
      const found = registry.get(callId);
      if (found) return resolve(found);
      if (performance.now() - startedAt >= timeoutMs) return resolve(null);
      setTimeout(tick, 50);
    };
    setTimeout(tick, 50);
  });
}
