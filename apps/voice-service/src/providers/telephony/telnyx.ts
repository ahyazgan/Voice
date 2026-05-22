// =============================================================================
// providers/telephony/telnyx.ts — ITelephonyProvider IMPLEMENTASYONU
// =============================================================================
// Faz 2'nin FİZİKSEL GİRİŞİ. Ses akışının hatta girdiği/çıktığı yer burası.
// Türkiye'nin "yerel arama" sorunu da tam burada çözülür (en alttaki nota bak).
//
// AKIŞ: placeCall() → Call Control API ile arama başlat → media WS aç → gelen
// ses onAudio'ya, giden ses sendAudio'dan media WS'e bas. Barge-in için
// stopPlayback() Telnyx "clear" event ile kuyruğu boşaltır.
//
// UYARI: Bu skeleton'dur. Telnyx Media Streaming gerçekte INBOUND WS kullanır
// (Telnyx → bizim sunucu). Aşağıda outbound client gösterildi — gerçek
// deployment'ta media WS server'ı ayrı kurulur ve buraya inject edilir.
// Hafta 1: önce dial() + sabit .wav oynatma testi (ARCHITECTURE §11 adım 1).
// =============================================================================

import { WebSocket } from 'ws';
import type {
  AudioChunk,
  ITelephonyProvider,
  PlaceCallOptions,
  TelephonySession,
} from '@voice/shared';

export interface TelnyxConfig {
  apiKey: string;
  connectionId: string;     // Telnyx Call Control App ID
  fromNumberE164: string;   // arayan numara (TR yerel; aşağıdaki nota bak)
  mediaWsUrl: string;       // Telnyx'in media stream için kullanacağı URL
}

export class TelnyxTelephonyProvider implements ITelephonyProvider {
  readonly name = 'telnyx';

  constructor(private readonly cfg: TelnyxConfig) {}

  async placeCall(opts: PlaceCallOptions): Promise<TelephonySession> {
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
        stream_url: this.cfg.mediaWsUrl,
        stream_track: 'both_tracks',
      }),
    });
    if (!res.ok) {
      throw new Error(`Telnyx dial başarısız: ${res.status} ${await res.text()}`);
    }
    const json = (await res.json()) as { data: { call_control_id: string } };
    return new TelnyxSession(this.cfg, opts.callId, json.data.call_control_id);
  }
}

// --- Tek bir aktif arama: media WS + control --------------------------------
class TelnyxSession implements TelephonySession {
  private mediaWs: WebSocket | null = null;
  private audioHandler: ((c: AudioChunk) => void) | null = null;
  private hangupHandler: (() => void) | null = null;
  private startMs = Date.now();
  private playing = false;

  constructor(
    private readonly cfg: TelnyxConfig,
    readonly callId: string,
    private readonly callControlId: string,
  ) {
    this.connectMedia();
  }

  private connectMedia(): void {
    const ws = new WebSocket(this.cfg.mediaWsUrl, {
      headers: { Authorization: `Bearer ${this.cfg.apiKey}` },
    });
    this.mediaWs = ws;

    ws.on('message', (raw) => {
      let msg: { event?: string; media?: { payload?: string } };
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg.event === 'media' && msg.media?.payload && this.audioHandler) {
        const bytes = Buffer.from(msg.media.payload, 'base64');
        this.audioHandler({
          data: new Uint8Array(bytes),
          sampleRate: 8000,
          encoding: 'pcmu',
          timestampMs: Date.now() - this.startMs,
        });
      }
      if (msg.event === 'stop') this.hangupHandler?.();
    });

    ws.on('close', () => this.hangupHandler?.());
    ws.on('error', () => this.hangupHandler?.());
  }

  onAudio(handler: (chunk: AudioChunk) => void): void {
    this.audioHandler = handler;
  }

  onHangup(handler: () => void): void {
    this.hangupHandler = handler;
  }

  sendAudio(chunk: AudioChunk): void {
    if (this.mediaWs?.readyState !== WebSocket.OPEN) return;
    this.playing = true;
    this.mediaWs.send(
      JSON.stringify({
        event: 'media',
        media: { payload: Buffer.from(chunk.data).toString('base64') },
      }),
    );
  }

  /** Barge-in: Telnyx 'clear' ile çalmamış paketleri sil. <200ms kritik. */
  stopPlayback(): void {
    if (!this.playing || this.mediaWs?.readyState !== WebSocket.OPEN) return;
    this.mediaWs.send(JSON.stringify({ event: 'clear' }));
    this.playing = false;
  }

  async hangup(_reason?: string): Promise<void> {
    try {
      await fetch(
        `https://api.telnyx.com/v2/calls/${this.callControlId}/actions/hangup`,
        { method: 'POST', headers: { Authorization: `Bearer ${this.cfg.apiKey}` } },
      );
    } finally {
      this.mediaWs?.close();
    }
  }
}

// =============================================================================
// 🇹🇷 TÜRKİYE HATTI — EN KRİTİK KONU (Hafta 1'de doğrula, kodlamadan önce)
// =============================================================================
// PROBLEM: Yurtdışı sağlayıcılar (Telnyx/Twilio) TR'ye/TR'den arama konusunda
// kısıtlı olabilir. TR yerel numara (+90) tahsisi ve giden arama regülasyona
// tabi. "Her şeyi kurdum ama TR'den arama gidemiyor" en sık duvar.
//
// SEÇENEKLER (önce GERÇEKTEN çalıştığını test et, varsayma):
//   1) Telnyx/Twilio + uluslararası terminasyon: çalışabilir ama TR yerel
//      numara göstermek zor; yabancı arayan no → açılma oranı DÜŞER.
//   2) Yerli SIP trunk / operatör (Türk Telekom toptan, BT sağlayıcıları,
//      yerli bulut santral firmaları): TR yerel numara + yasal giden arama.
//      Genelde DOĞRU yol. SIP trunk'ı bu provider'ın ardına alırsın.
//   3) Hibrit: orkestrasyon/media yurtdışı, SIP terminasyon yerli trunk.
//
// ITelephonyProvider sayesinde hangi yolu seçersen seç orchestrator değişmez —
// sadece bu dosyanın bir kardeşi (örn. yerelSipProvider.ts) yazılır.
//
// AÇILMA ORANI: Arayan numara TR yerel (bölgesel/0850) olmalı. Bilinmeyen/
// yurtdışı no kimse açmaz → tüm sistem boşa gider. Teknik değil İŞ kararı.
//
// REGÜLASYON: Ticari giden arama + arama kaydı TR'de kurallıdır (BTK + KVKK).
// Arama saatleri, rıza anonsu, taciz sınırı (MAX_NEGOTIATION_ATTEMPTS) bu
// yüzden var. Hattı kurarken yasal danışmanlık al.
// =============================================================================
