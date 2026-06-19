// =============================================================================
// providers/stt/deepgram.ts — ISTTProvider (Deepgram streaming, Faz 2)
// =============================================================================
// Türkçe telefon STT. Deepgram streaming WS'ine μ-law/8000 ses akıtır;
// interim_results → 'partial' (barge-in tetikleyici), speech_final/UtteranceEnd
// → 'final' (tur sonu). nova-2 modeli TR destekler.
//
// TASARIM: mesaj-parse mantığı saf bir `DeepgramMessageHandler`'a ayrıldı (WS'ten
// bağımsız) → gerçek bağlantı olmadan birim testiyle kapsanır. Session yalnızca
// WS yaşam döngüsü + audio push + keepalive yönetir.
//
// Deepgram protokolü: https://developers.deepgram.com/docs/streaming
// =============================================================================

import { WebSocket } from 'ws';
import { EventEmitter } from 'node:events';
import type { AudioChunk, ISTTProvider, STTEvent, STTOptions, STTSession } from '@voice/shared';
import { env } from '../../config.js';
import { logger } from '../../telemetry.js';

export interface DeepgramConfig {
  apiKey: string;
  model: string;
  language: string;
  endpointingMs: number;
  utteranceEndMs: number;
}

// --- Deepgram mesaj tipleri (kullandığımız alt küme) ------------------------
interface DeepgramResultsMsg {
  type: 'Results';
  channel: { alternatives: { transcript: string }[] };
  is_final: boolean;
  speech_final?: boolean;
  start: number;
  duration: number;
}
interface DeepgramUtteranceEndMsg {
  type: 'UtteranceEnd';
  last_word_end?: number;
}
type DeepgramMsg = DeepgramResultsMsg | DeepgramUtteranceEndMsg | { type: string };

/**
 * SAF mesaj işleyici — Deepgram JSON'unu STTEvent'lere çevirir. WS yok, I/O yok.
 * `is_final` parçalarını biriktirir; `speech_final`/`UtteranceEnd`'de tek 'final'
 * yayar. Böylece cümle ortasında erken tetikleme olmaz.
 */
export class DeepgramMessageHandler {
  private pending = '';
  private firstStart: number | null = null;
  private lastEnd = 0;

  /** Bir Deepgram mesajını işler, üretilecek STTEvent'leri döndürür (0..n). */
  handle(msg: DeepgramMsg): STTEvent[] {
    if (msg.type === 'Results') {
      const r = msg as DeepgramResultsMsg;
      const text = r.channel?.alternatives?.[0]?.transcript ?? '';
      if (!text.trim()) return [];

      if (this.firstStart === null) this.firstStart = r.start;
      this.lastEnd = r.start + r.duration;

      if (!r.is_final) {
        // interim → barge-in için partial (biriktirilmiş + güncel).
        return [{ type: 'partial', text: (this.pending + ' ' + text).trim() }];
      }
      // is_final parçası → biriktir.
      this.pending = (this.pending + ' ' + text).trim();
      if (r.speech_final) {
        return [this.flushFinal()];
      }
      return [];
    }

    if (msg.type === 'UtteranceEnd') {
      // Konuşma kesin bitti; biriken metni final yap (varsa).
      if (this.pending) return [this.flushFinal()];
      return [];
    }

    return [];
  }

  private flushFinal(): STTEvent {
    const durationMs = this.firstStart !== null ? Math.round((this.lastEnd - this.firstStart) * 1000) : 0;
    const evt: STTEvent = { type: 'final', text: this.pending, durationMs: Math.max(0, durationMs) };
    this.pending = '';
    this.firstStart = null;
    this.lastEnd = 0;
    return evt;
  }
}

class DeepgramSTTSession implements STTSession {
  private ws: WebSocket;
  private emitter = new EventEmitter();
  private handler = new DeepgramMessageHandler();
  private buffer: Uint8Array[] = [];
  private open = false;
  private closed = false;
  private keepAlive: NodeJS.Timeout;

  constructor(cfg: DeepgramConfig, opts: STTOptions) {
    const encoding = opts.sampleRate === 8000 ? 'mulaw' : 'linear16';
    const params = new URLSearchParams({
      model: cfg.model,
      language: cfg.language,
      encoding,
      sample_rate: String(opts.sampleRate),
      channels: '1',
      interim_results: 'true',
      punctuate: 'true',
      smart_format: 'true',
      endpointing: String(cfg.endpointingMs),
      utterance_end_ms: String(cfg.utteranceEndMs),
      vad_events: 'true',
    });

    this.ws = new WebSocket(`wss://api.deepgram.com/v1/listen?${params.toString()}`, {
      headers: { Authorization: `Token ${cfg.apiKey}` },
    });

    this.ws.on('open', () => {
      this.open = true;
      for (const chunk of this.buffer) this.ws.send(chunk);
      this.buffer = [];
    });
    this.ws.on('message', (raw) => this.onMessage(raw.toString()));
    this.ws.on('error', (err) => logger.error({ err }, 'deepgram ws error'));
    this.ws.on('close', () => { this.open = false; });

    // Sessizlikte (susan müşteri) Deepgram WS'i düşürmesin diye keepalive.
    this.keepAlive = setInterval(() => {
      if (this.open && !this.closed) this.ws.send(JSON.stringify({ type: 'KeepAlive' }));
    }, 8000);
  }

  private onMessage(raw: string): void {
    let msg: DeepgramMsg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    for (const evt of this.handler.handle(msg)) {
      this.emitter.emit('event', evt);
    }
  }

  push(chunk: AudioChunk): void {
    if (this.closed) return;
    if (this.open) this.ws.send(chunk.data);
    else this.buffer.push(chunk.data); // open'dan önce gelen paketleri flush'la
  }

  onEvent(handler: (evt: STTEvent) => void): void {
    this.emitter.on('event', handler);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.keepAlive);
    try {
      if (this.open) this.ws.send(JSON.stringify({ type: 'CloseStream' }));
      this.ws.close();
    } catch {
      /* noop */
    }
    this.emitter.removeAllListeners();
  }
}

export class DeepgramSTT implements ISTTProvider {
  readonly name = 'deepgram';
  constructor(private readonly cfg: DeepgramConfig) {}

  createSession(opts: STTOptions): STTSession {
    return new DeepgramSTTSession(this.cfg, opts);
  }
}

/** config.ts env'inden DeepgramConfig kurar. */
export function deepgramConfigFromEnv(apiKey: string): DeepgramConfig {
  return {
    apiKey,
    model: env.DEEPGRAM_MODEL,
    language: env.DEEPGRAM_LANGUAGE,
    endpointingMs: env.DEEPGRAM_ENDPOINTING_MS,
    utteranceEndMs: env.DEEPGRAM_UTTERANCE_END_MS,
  };
}
