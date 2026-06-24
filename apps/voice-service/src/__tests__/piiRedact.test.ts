// =============================================================================
// piiRedact.test.ts — pino redact davranış + path geçerlilik testi
// =============================================================================
// PII_REDACT hem api hem voice-service logger'ında kullanılıyor. Bu test:
//  1) Path'ler pino için GEÇERLİ (geçersiz path logger init'te fırlatır) — aynı
//     config api'de de kullanıldığından bu, api logger'ı için de güvence.
//  2) Ham PII (telefon/isim/transkript) gerçekten [PII] ile maskeleniyor.
// =============================================================================

import { describe, it, expect } from 'vitest';
import pino from 'pino';
import { PII_REDACT, maskPhone, maskName } from '@voice/shared';

/** PII_REDACT ile yapılandırılmış logger kurar, çıktıyı stringe yakalar. */
function captureLog(obj: unknown): string {
  let out = '';
  const stream: pino.DestinationStream = { write: (s: string) => { out += s; } };
  const log = pino({ redact: PII_REDACT }, stream);
  log.info(obj as object, 'test');
  return out;
}

describe('PII_REDACT', () => {
  it('geçerli pino path config (init fırlatmaz)', () => {
    const sink: pino.DestinationStream = { write: () => {} };
    expect(() => pino({ redact: PII_REDACT }, sink)).not.toThrow();
  });

  it('doğrudan telefon/isim alanlarını maskeler', () => {
    const out = captureLog({ phoneE164: '+905551112233', fullName: 'Ayşe Demir' });
    expect(out).not.toContain('+905551112233');
    expect(out).not.toContain('Ayşe Demir');
    expect(out).toContain('[PII]');
  });

  it('iç içe debtor nesnesini maskeler (callContext.debtor.phoneE164)', () => {
    const out = captureLog({ callContext: { debtor: { phoneE164: '+905551112233', fullName: 'Ayşe Demir' } } });
    expect(out).not.toContain('+905551112233');
    expect(out).not.toContain('Ayşe Demir');
  });

  it('transkript/müşteri metnini maskeler', () => {
    const out = captureLog({ text: 'gizli ifade', userText: 'müşterinin söyledikleri' });
    expect(out).not.toContain('gizli ifade');
    expect(out).not.toContain('müşterinin söyledikleri');
  });

  it('PII olmayan alanlar (callId, debtorId) korunur', () => {
    const out = captureLog({ callId: 'c1', debtorId: 'd1' });
    expect(out).toContain('c1');
    expect(out).toContain('d1');
  });
});

describe('maskeleme yardımcıları (mevcut)', () => {
  it('maskPhone yalnızca son 4 haneyi gösterir (+ korunur)', () => {
    expect(maskPhone('+905551112233')).toBe('+********2233');
  });
  it('maskName ilk ad + soyad baş harfi', () => {
    expect(maskName('Ayşe Demir')).toBe('Ayşe D.');
  });
});
