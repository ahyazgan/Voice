import { describe, it, expect } from 'vitest';
import {
  detectEmotionalCue,
  responseDelayMs,
  voiceToneForState,
  pickThinkingFiller,
  type VoiceTone,
} from '@voice/shared';

describe('detectEmotionalCue', () => {
  it('zorluk/duygu ipuçlarını yakalar', () => {
    for (const t of [
      'işten çıkarıldım',
      'şu an param yok',
      'maaşımı alamadım',
      'eşim hastanede yatıyor',
      'babam vefat etti',
      'çok zor bir dönemdeyim',
      'icra geldi kapıya',
    ]) {
      expect(detectEmotionalCue(t)).toBe(true);
    }
  });
  it('nötr girdide tetiklenmez', () => {
    expect(detectEmotionalCue('evet ödeyeceğim')).toBe(false);
    expect(detectEmotionalCue('tamam yarın hallederim')).toBe(false);
    expect(detectEmotionalCue('')).toBe(false);
  });
});

describe('responseDelayMs', () => {
  it('duygusal anda empati duraklaması döner', () => {
    expect(responseDelayMs('işsizim, param yok', { empathyPauseMs: 600 })).toBe(600);
  });
  it('nötr girdide gecikme yok (KPI korunur)', () => {
    expect(responseDelayMs('evet ödeyeceğim', { empathyPauseMs: 600 })).toBe(0);
  });
  it('empathyPauseMs=0 ise duygusal anda da 0', () => {
    expect(responseDelayMs('hastayım', { empathyPauseMs: 0 })).toBe(0);
  });
});

describe('voiceToneForState', () => {
  const base: VoiceTone = { stability: 0.6, style: 0.0 };

  it('teyitte daha net/sabit (stability artar, style düşmez negatife)', () => {
    const t = voiceToneForState('confirm', base);
    expect(t.stability).toBeCloseTo(0.7);
    expect(t.style).toBe(0); // 0 - 0.1 → clamp 0
  });
  it('pazarlıkta en sıcak (stability düşer, style artar)', () => {
    const t = voiceToneForState('negotiate', base);
    expect(t.stability).toBeCloseTo(0.45);
    expect(t.style).toBeCloseTo(0.2);
  });
  it('0-1 aralığına kırpılır', () => {
    const hi: VoiceTone = { stability: 0.95, style: 0.95 };
    const t = voiceToneForState('confirm', hi);
    expect(t.stability).toBeLessThanOrEqual(1);
    expect(t.style).toBeLessThanOrEqual(1);
  });
  it('greeting nötr (tabana eşit)', () => {
    expect(voiceToneForState('greeting', base)).toEqual(base);
  });
});

describe('pickThinkingFiller', () => {
  it('duruma uygun dolgu döner', () => {
    expect(pickThinkingFiller('negotiate', 0)).toBe('Anlıyorum,');
  });
  it('tur indeksine göre rotasyon (aynı kalıbı tekrarlamaz)', () => {
    const a = pickThinkingFiller('remind', 0);
    const b = pickThinkingFiller('remind', 1);
    expect(a).not.toBe(b);
  });
  it('indeks taşması güvenli (modulo)', () => {
    expect(() => pickThinkingFiller('confirm', 999)).not.toThrow();
    expect(typeof pickThinkingFiller('confirm', 999)).toBe('string');
  });
});
