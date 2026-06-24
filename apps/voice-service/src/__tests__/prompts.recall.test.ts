import { describe, it, expect } from 'vitest';
import type { Debtor, PriorCallSummary } from '@voice/shared';
import { systemPromptFor } from '../prompts/index.js';

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
