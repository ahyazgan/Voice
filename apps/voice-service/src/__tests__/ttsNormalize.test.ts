import { describe, it, expect } from 'vitest';
import { normalizeForTTS, turkishNumber } from '@voice/shared';

describe('turkishNumber', () => {
  it('temel sayılar', () => {
    expect(turkishNumber(0)).toBe('sıfır');
    expect(turkishNumber(5)).toBe('beş');
    expect(turkishNumber(15)).toBe('on beş');
    expect(turkishNumber(100)).toBe('yüz');
    expect(turkishNumber(250)).toBe('iki yüz elli');
  });
  it('bin için "bir bin" demez', () => {
    expect(turkishNumber(1000)).toBe('bin');
    expect(turkishNumber(1250)).toBe('bin iki yüz elli');
    expect(turkishNumber(2026)).toBe('iki bin yirmi altı');
  });
  it('büyük sayılar', () => {
    expect(turkishNumber(1_250_000)).toBe('bir milyon iki yüz elli bin');
  });
});

describe('normalizeForTTS — para', () => {
  it('Türk biçimi tutar → kelime + lira', () => {
    expect(normalizeForTTS('Tutar 1.250,00 TL.')).toBe('Tutar bin iki yüz elli lira.');
  });
  it('kuruşlu tutar', () => {
    expect(normalizeForTTS('1.250,50 TL borcunuz var')).toBe('bin iki yüz elli lira elli kuruş borcunuz var');
  });
  it('₺ ve "lira" sonekleri', () => {
    expect(normalizeForTTS('500 ₺')).toBe('beş yüz lira');
    expect(normalizeForTTS('75 lira')).toBe('yetmiş beş lira');
  });
});

describe('normalizeForTTS — tarih', () => {
  it('ISO tarih → gün + ay adı', () => {
    expect(normalizeForTTS('Ödeme tarihi 2026-04-15.')).toBe('Ödeme tarihi on beş Nisan.');
  });
  it('farklı aylar', () => {
    expect(normalizeForTTS('2026-01-01')).toBe('bir Ocak');
    expect(normalizeForTTS('2026-12-31')).toBe('otuz bir Aralık');
  });
});

describe('normalizeForTTS — dokunmaması gerekenler', () => {
  it('düz metni değiştirmez', () => {
    const t = 'Ayşe Hanım ile mi görüşüyorum?';
    expect(normalizeForTTS(t)).toBe(t);
  });
  it('para/tarih içermeyen sayıyı tek başına çevirmez (over-eager olmasın)', () => {
    // "5 dakika" para/tarih değil → dokunma
    expect(normalizeForTTS('5 dakika sonra')).toBe('5 dakika sonra');
  });
});
