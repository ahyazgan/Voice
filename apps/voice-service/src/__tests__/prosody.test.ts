import { describe, it, expect } from 'vitest';
import { paceForDelivery, normalizeForTTS } from '@voice/shared';

describe('paceForDelivery', () => {
  it('para figüründen sonra duraklama (virgül) ekler', () => {
    expect(paceForDelivery('Borcunuz 1.250 TL bu ay ödenmeli')).toBe(
      'Borcunuz 1.250 TL, bu ay ödenmeli',
    );
    expect(paceForDelivery('500 lira ödeyin lütfen')).toBe('500 lira, ödeyin lütfen');
  });
  it('tarih ve yüzde figüründen sonra da', () => {
    expect(paceForDelivery('Vade 2026-04-15 olarak görünüyor')).toBe(
      'Vade 2026-04-15, olarak görünüyor',
    );
    expect(paceForDelivery('%25 indirim var')).toBe('%25, indirim var');
  });
  it('zaten noktalama geliyorsa dokunmaz', () => {
    expect(paceForDelivery('Tutar 1.250,00 TL.')).toBe('Tutar 1.250,00 TL.');
    expect(paceForDelivery('1.250 TL, zaten virgül')).toBe('1.250 TL, zaten virgül');
  });
  it('figür içermeyen metni değiştirmez', () => {
    const t = 'Merhaba Ayşe Hanım, nasılsınız?';
    expect(paceForDelivery(t)).toBe(t);
  });
  it('pace → normalize zinciri: duraklama korunarak insan okunuşu', () => {
    const spoken = normalizeForTTS(paceForDelivery('Borcunuz 1.250 TL bu ay'));
    expect(spoken).toBe('Borcunuz bin iki yüz elli lira, bu ay');
  });
});
