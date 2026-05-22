// =============================================================================
// providers/tts/elevenlabs.ts — Türkçe TTS akış sağlayıcısı
// =============================================================================
// Ürünün en kritik farklılaştırıcısı: TÜRKÇE doğallık. ElevenLabs Flash/Turbo
// modelleri Türkçe destekler ve telefon kalitesinde (μ-law 8kHz) doğrudan
// çıktı verebilir — resample gerekmez.
//
// AKIŞ:
//   provider.synthesizeStream(text, { sampleRate }) → AsyncIterable<AudioChunk>
//   Her chunk telefonun gerçek-zaman hızında session.sendAudio'ya basılır.
//
// Format seçimi: caller'ın sampleRate'ine göre çıkış formatı belirlenir.
//   8000  → ulaw_8000 (μ-law, telefon standardı, Telnyx/Twilio için ideal)
//   16000 → pcm_16000 (STT/lokal test için)
//   diğer → en yakın PCM
//
// Fetch + Web Streams API kullanılıyor (Node 20+); SDK bağımlılığı yok.
// =============================================================================

import type { AudioChunk, ITTSProvider, TTSOptions } from '@voice/shared';
import { logger } from '../../telemetry.js';

export interface ElevenLabsConfig {
  apiKey: string;
  voiceId: string;
  /** eleven_turbo_v2_5 = en hızlı (~300ms); eleven_multilingual_v2 = en doğal */
  model: string;
  /** 0-1; düşük = monoton ama tutarlı, yüksek = duygulu ama dalgalı */
  stability?: number;
  /** 0-1; sesin orijinaline ne kadar yakın */
  similarityBoost?: number;
}

interface FormatChoice {
  outputFormat: string; // ElevenLabs API param
  encoding: AudioChunk['encoding'];
}

function pickFormat(sampleRate: number): FormatChoice {
  if (sampleRate === 8000) return { outputFormat: 'ulaw_8000', encoding: 'pcmu' };
  if (sampleRate === 16000) return { outputFormat: 'pcm_16000', encoding: 'pcm16' };
  if (sampleRate === 22050) return { outputFormat: 'pcm_22050', encoding: 'pcm16' };
  if (sampleRate === 24000) return { outputFormat: 'pcm_24000', encoding: 'pcm16' };
  if (sampleRate === 44100) return { outputFormat: 'pcm_44100', encoding: 'pcm16' };
  // Bilinmeyen sample rate → en yakın PCM. Caller resample'a hazırlıklı olmalı.
  return { outputFormat: 'pcm_16000', encoding: 'pcm16' };
}

export class ElevenLabsTTS implements ITTSProvider {
  readonly name = 'elevenlabs';

  constructor(private readonly cfg: ElevenLabsConfig) {}

  async *synthesizeStream(text: string, opts: TTSOptions): AsyncIterable<AudioChunk> {
    const fmt = pickFormat(opts.sampleRate);
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(
      this.cfg.voiceId,
    )}/stream?output_format=${fmt.outputFormat}`;

    const body = {
      text,
      model_id: this.cfg.model,
      voice_settings: {
        stability: this.cfg.stability ?? 0.5,
        similarity_boost: this.cfg.similarityBoost ?? 0.75,
      },
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': this.cfg.apiKey,
        accept: 'audio/*',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      logger.error(
        { status: res.status, err: errText.slice(0, 500), voiceId: this.cfg.voiceId },
        'elevenlabs synth failed',
      );
      throw new Error(`ElevenLabs ${res.status}: ${errText.slice(0, 200)}`);
    }

    if (!res.body) {
      throw new Error('ElevenLabs: response.body null');
    }

    const reader = res.body.getReader();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) return;
        if (value && value.byteLength > 0) {
          yield {
            data: value,
            sampleRate: opts.sampleRate,
            encoding: fmt.encoding,
          };
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
