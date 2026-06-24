import { describe, it, expect } from 'vitest';
import { isBackchannel, isLikelyBargeIn } from '../backchannel.js';

describe('isBackchannel', () => {
  it('kısa onaylar backchannel', () => {
    for (const t of ['hı hı', 'tamam', 'evet', 'tabii', 'anladım', 'hmm', 'peki']) {
      expect(isBackchannel(t)).toBe(true);
    }
  });
  it('noktalama/büyük harf toleransı', () => {
    expect(isBackchannel('Tamam.')).toBe(true);
    expect(isBackchannel('Evet!')).toBe(true);
  });
  it('boş/gürültü → backchannel (tur değil)', () => {
    expect(isBackchannel('')).toBe(true);
    expect(isBackchannel('   ')).toBe(true);
  });
  it('gerçek konuşma backchannel DEĞİL', () => {
    expect(isBackchannel('evet ödeyeceğim')).toBe(false);
    expect(isBackchannel('tamam yarın hallederim')).toBe(false);
    expect(isBackchannel('bu borcu kabul etmiyorum')).toBe(false);
  });
  it('tek anlamlı kelime backchannel değil', () => {
    expect(isBackchannel('ödemem')).toBe(false);
    expect(isBackchannel('itiraz')).toBe(false);
  });
});

describe('isLikelyBargeIn', () => {
  it('gerçek kesme niyeti → true', () => {
    expect(isLikelyBargeIn('alo kimsiniz')).toBe(true);
    expect(isLikelyBargeIn('dur bir saniye')).toBe(true);
    expect(isLikelyBargeIn('ödemem')).toBe(true);
  });
  it('backchannel/boş/gürültü → false (AI susmaz)', () => {
    expect(isLikelyBargeIn('hı hı')).toBe(false);
    expect(isLikelyBargeIn('tamam')).toBe(false);
    expect(isLikelyBargeIn('')).toBe(false);
    expect(isLikelyBargeIn('   ')).toBe(false);
  });
});
