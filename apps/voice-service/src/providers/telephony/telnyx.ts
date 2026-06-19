// =============================================================================
// providers/telephony/telnyx.ts — ITelephonyProvider (Telnyx, Faz 2)
// =============================================================================
// Telnyx Media Streaming INBOUND'dur: placeCall, Call Control API ile aramayı
// başlatır ve `stream_url` parametresiyle Telnyx'e "şu WSS'ye bağlan" der; Telnyx
// BİZİM media WS server'ımıza bağlanır ve start/media/stop event'leri gönderir.
//
// Bu yüzden retell.ts'teki köprü kalıbının aynısını kullanırız:
//   placeCall() → REST dial + registry'e session yaz → session döndür.
//   Telnyx WS bağlanır → server.ts handleTelnyxMediaWs(ws, callId) → registry'den
//   session bulunur, WS o session'a bağlanır (onAudio beslenir, sendAudio çalışır).
//
// base64 μ-law payload ↔ AudioChunk: gelen media.payload base64-decode → pcmu/8000;
// giden chunk.data → base64 → media event. Barge-in: 'clear' event ile kuyruk boşalt.
//
// 🇹🇷 TR HATTI NOTU (en altta) — kod-dışı engel, önce regülasyon/yerel numara doğrula.
// =============================================================================

import type { WebSocket } from 'ws';
import type {
  AudioChunk,
  ITelephonyProvider,
  PlaceCallOptions,
  TelephonySession,
} from '@voice/shared';
import { logger } from '../../telemetry.js';

export interface TelnyxConfig {
  apiKey: string;
  connectionId: string;
  fromNumberE164: string;
  /** Telnyx'in media stream için bağlanacağı BİZİM public WSS base'imiz
   *  (örn. wss://abc.ngrok.io). placeCall buna /telnyx-media/<callId> ekler. */
  publicWsBase: string;
}

// --- callId → bekleyen media oturumu (retell.ts registry kalıbı) ------------
const mediaRegistry = new Map<string, TelnyxSession>();

export class TelnyxTelephonyProvider implements ITelephonyProvider {
  readonly name = 'telnyx';

  constructor(private readonly cfg: TelnyxConfig) {}

  async placeCall(opts: PlaceCallOptions): Promise<TelephonySession> {
    const streamUrl = `${this.cfg.publicWsBase.replace(/\/$/, '')}/telnyx-media/${encodeURIComponent(opts.callId)}`;
    const res = await fetch('https://api.telnyx.com/v2/calls', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.cfg.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        connection_id: this.cfg.connectionId,
        to: opts.to,
        from: opts.from || this.cfg.fromNumberE164,
        stream_url: streamUrl,
        // Yalnızca müşteri sesi (echo riski yok); kendi TTS'imizi sendAudio ile basarız.
        stream_track: 'inbound_track',
        stream_bidirectional_mode: 'rtp',
      }),
    });
    if (!res.ok) {
      throw new Error(`Telnyx dial başarısız: ${res.status}`);
    }
    const json = (await res.json()) as { data: { call_control_id: string } };

    const session = new TelnyxSession(this.cfg, opts.callId, json.data.call_control_id);
    mediaRegistry.set(opts.callId, session);
    logger.info({ callId: opts.callId, streamUrl }, 'telnyx call placed; awaiting media ws');
    return session;
  }
}

// --- Tek aktif aramanın media oturumu ---------------------------------------
class TelnyxSession implements TelephonySession {
  private ws: WebSocket | null = null;
  private audioHandler: ((c: AudioChunk) => void) | null = null;
  private hangupHandler: (() => void) | null = null;
  private startMs = 0;
  private playing = false;
  private ended = false;

  constructor(
    private readonly cfg: TelnyxConfig,
    readonly callId: string,
    private readonly callControlId: string,
  ) {}

  /** handleTelnyxMediaWs inbound WS'i bağladığında çağrılır. */
  attachMediaWs(ws: WebSocket): void {
    this.ws = ws;
    this.startMs = performance.now();
  }

  /** Telnyx'ten gelen media event'i AudioChunk'a çevirip onAudio'ya iletir. */
  ingestMedia(payloadB64: string): void {
    if (!this.audioHandler) return;
    const bytes = Buffer.from(payloadB64, 'base64');
    this.audioHandler({
      data: new Uint8Array(bytes),
      sampleRate: 8000,
      encoding: 'pcmu',
      timestampMs: Math.round(performance.now() - this.startMs),
    });
  }

  notifyHangup(): void {
    this.hangupHandler?.();
  }

  onAudio(handler: (chunk: AudioChunk) => void): void {
    this.audioHandler = handler;
  }
  onHangup(handler: () => void): void {
    this.hangupHandler = handler;
  }

  sendAudio(chunk: AudioChunk): void {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return;
    this.playing = true;
    this.ws.send(
      JSON.stringify({
        event: 'media',
        media: { payload: Buffer.from(chunk.data).toString('base64') },
      }),
    );
  }

  /** Barge-in: Telnyx 'clear' ile çalmamış paketleri sil. <200ms kritik. */
  stopPlayback(): void {
    if (!this.playing || !this.ws || this.ws.readyState !== this.ws.OPEN) return;
    this.ws.send(JSON.stringify({ event: 'clear' }));
    this.playing = false;
  }

  async hangup(_reason?: string): Promise<void> {
    if (this.ended) return;
    this.ended = true;
    mediaRegistry.delete(this.callId);
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 3000);
    try {
      await fetch(`https://api.telnyx.com/v2/calls/${this.callControlId}/actions/hangup`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.cfg.apiKey}` },
        signal: ac.signal,
      });
    } catch (err) {
      logger.warn({ err, callId: this.callId }, 'telnyx hangup failed (ignored)');
    } finally {
      clearTimeout(timer);
      try { this.ws?.close(); } catch { /* noop */ }
    }
  }
}

// --- Telnyx media event tipleri (alt küme) ----------------------------------
interface TelnyxMediaEvent {
  event: 'connected' | 'start' | 'media' | 'stop' | string;
  media?: { payload?: string };
}

/**
 * Gelen Telnyx media WebSocket'ini ilgili oturuma bağlar (retell köprü kalıbı).
 * server.ts, ws yolundan callId'yi ayıklayıp bunu çağırır.
 */
export function handleTelnyxMediaWs(ws: WebSocket, callId: string): void {
  const session = mediaRegistry.get(callId);
  if (!session) {
    logger.warn({ callId }, 'telnyx media ws: no matching session, closing');
    ws.close(1011, 'unknown call');
    return;
  }
  session.attachMediaWs(ws);
  logger.info({ callId }, 'telnyx media ws attached');

  ws.on('message', (raw) => {
    let msg: TelnyxMediaEvent;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.event === 'media' && msg.media?.payload) {
      session.ingestMedia(msg.media.payload);
    } else if (msg.event === 'stop') {
      session.notifyHangup();
    }
  });

  ws.on('close', () => session.notifyHangup());
  ws.on('error', (err) => {
    logger.error({ err, callId }, 'telnyx media ws error');
    session.notifyHangup();
  });
}

// =============================================================================
// 🇹🇷 TÜRKİYE HATTI — EN KRİTİK KONU (kod-dışı; önce regülasyon/yerel numara doğrula)
// =============================================================================
// Yurtdışı sağlayıcılar (Telnyx/Twilio) TR'ye/TR'den giden aramada kısıtlı olabilir.
// TR yerel numara (+90) tahsisi ve giden arama BTK'ya tabi. Yabancı arayan numara
// → açılma oranı düşer. Doğru yol genelde yerli SIP trunk; ITelephonyProvider
// sayesinde bu kardeş bir dosya olur (örn. yerelSip.ts), orchestrator değişmez.
// =============================================================================
