import { describe, it, expect } from 'vitest';
import { PriorCallSummarySchema, type Debtor, type PriorCallSummary } from '@voice/shared';
import { systemPromptFor } from '../prompts/index.js';

describe('PriorCallSummarySchema (API ↔ voice-service kontratı)', () => {
  it("API'nin ürettiği biçimi kabul eder", () => {
    const fromApi = {
      at: new Date('2026-06-15').toISOString(),
      outcome: 'PROMISE_TO_PAY',
      promisedAmount: 50000,
      promisedDate: new Date('2026-06-20').toISOString(),
    };
    expect(PriorCallSummarySchema.safeParse(fromApi).success).toBe(true);
  });
  it('opsiyonel alanlar olmadan da geçerli', () => {
    const minimal = { at: new Date('2026-06-15').toISOString(), outcome: 'REFUSED' };
    expect(PriorCallSummarySchema.safeParse(minimal).success).toBe(true);
  });
  it('geçersiz outcome reddedilir', () => {
    const bad = { at: new Date('2026-06-15').toISOString(), outcome: 'NOPE' };
    expect(PriorCallSummarySchema.safeParse(bad).success).toBe(false);
  });
});

const debtor: Debtor = {
  id: 'd1',
  fullName: 'Ayşe Demir',
  phoneE164: '+905551112233',
  amountDue: 125000,
  currency: 'TRY',
  dueDate: new Date('2026-04-01').toISOString(),
};

describe('cross-call memory — recall note', () => {
  it('priorCall yoksa GEÇMİŞ notu eklenmez', () => {
    const p = systemPromptFor('remind', { debtor });
    expect(p).not.toContain('GEÇMİŞ');
  });

  it('PROMISE_TO_PAY geçmişinde hatırlatma + tutar geçer', () => {
    const priorCall: PriorCallSummary = {
      at: new Date('2026-06-15').toISOString(),
      outcome: 'PROMISE_TO_PAY',
      promisedAmount: 50000,
      promisedDate: new Date('2026-06-20').toISOString(),
    };
    const p = systemPromptFor('remind', { debtor, priorCall });
    expect(p).toContain('GEÇMİŞ');
    expect(p).toContain('ödeme sözü');
  });

  it('WRONG_NUMBER geçmişinde hatırlatma YAPILMAZ (KVKK/rahatsızlık)', () => {
    const priorCall: PriorCallSummary = {
      at: new Date('2026-06-15').toISOString(),
      outcome: 'WRONG_NUMBER',
    };
    const p = systemPromptFor('remind', { debtor, priorCall });
    expect(p).not.toContain('GEÇMİŞ');
  });

  it('DISPUTE geçmişi itiraz bağlamını taşır', () => {
    const priorCall: PriorCallSummary = {
      at: new Date('2026-06-15').toISOString(),
      outcome: 'DISPUTE',
    };
    const p = systemPromptFor('remind', { debtor, priorCall });
    expect(p).toContain('itiraz');
  });
});
