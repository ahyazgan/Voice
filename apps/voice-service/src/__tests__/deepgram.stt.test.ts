// =============================================================================
// deepgram.stt.test.ts — Deepgram mesaj-parse mantığı (WS'siz, saf)
// =============================================================================
// is_final parçalarının birikmesi, speech_final/UtteranceEnd'de tek 'final',
// interim'lerin 'partial' (barge-in) olması, durationMs hesabı.
// =============================================================================

import { describe, it, expect } from 'vitest';
import { DeepgramMessageHandler } from '../providers/stt/deepgram.js';

function results(transcript: string, isFinal: boolean, opts: { speechFinal?: boolean; start?: number; duration?: number } = {}) {
  return {
    type: 'Results',
    channel: { alternatives: [{ transcript }] },
    is_final: isFinal,
    speech_final: opts.speechFinal ?? false,
    start: opts.start ?? 0,
    duration: opts.duration ?? 1,
  };
}

describe('DeepgramMessageHandler', () => {
  it('interim sonucu → partial (barge-in tetikleyici)', () => {
    const h = new DeepgramMessageHandler();
    const out = h.handle(results('eve', false, { start: 0, duration: 0.5 }));
    expect(out).toEqual([{ type: 'partial', text: 'eve' }]);
  });

  it('boş transcript → event yok', () => {
    const h = new DeepgramMessageHandler();
    expect(h.handle(results('   ', false))).toEqual([]);
    expect(h.handle(results('', true))).toEqual([]);
  });

  it('is_final parçaları birikir, speech_final\'de tek final yayar', () => {
    const h = new DeepgramMessageHandler();
    expect(h.handle(results('Evet', true, { start: 0, duration: 0.5 }))).toEqual([]);
    const out = h.handle(results('benim', true, { speechFinal: true, start: 0.5, duration: 0.5 }));
    expect(out).toEqual([{ type: 'final', text: 'Evet benim', durationMs: 1000 }]);
  });

  it('UtteranceEnd biriken metni final yapar', () => {
    const h = new DeepgramMessageHandler();
    h.handle(results('Yarın', true, { start: 0, duration: 0.8 }));
    h.handle(results('öderim', true, { start: 0.8, duration: 0.7 }));
    const out = h.handle({ type: 'UtteranceEnd' });
    expect(out).toEqual([{ type: 'final', text: 'Yarın öderim', durationMs: 1500 }]);
  });

  it('UtteranceEnd biriken metin yoksa event üretmez', () => {
    const h = new DeepgramMessageHandler();
    expect(h.handle({ type: 'UtteranceEnd' })).toEqual([]);
  });

  it('final sonrası state sıfırlanır (yeni tur temiz başlar)', () => {
    const h = new DeepgramMessageHandler();
    h.handle(results('İlk', true, { speechFinal: true, start: 0, duration: 1 }));
    // Yeni tur
    const out = h.handle(results('İkinci', true, { speechFinal: true, start: 5, duration: 1 }));
    expect(out).toEqual([{ type: 'final', text: 'İkinci', durationMs: 1000 }]);
  });

  it('bilinmeyen mesaj tipleri yok sayılır', () => {
    const h = new DeepgramMessageHandler();
    expect(h.handle({ type: 'Metadata' })).toEqual([]);
    expect(h.handle({ type: 'SpeechStarted' })).toEqual([]);
  });
});
