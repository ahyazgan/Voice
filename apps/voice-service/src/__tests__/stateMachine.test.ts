// =============================================================================
// stateMachine.test.ts — durum makinesi doğruluğu + prompt↔machine intent drift
// =============================================================================
import { describe, it, expect } from 'vitest';
import type { ConversationState, Debtor, LLMIntent } from '@voice/shared';
import { startConversation, currentState, eventFromIntent } from '../stateMachine.js';
import { intentsForState } from '../prompts/index.js';

const debtor: Debtor = {
  id: 'd1',
  fullName: 'Ayşe Yılmaz',
  phoneE164: '+905551112233',
  amountDue: 125000, // 1.250,00 TL (kuruş)
  currency: 'TRY',
  dueDate: '2026-07-01T00:00:00.000Z',
};

// Temsilî event: guard'lı geçişler (WILL_PAY/PARTIAL hasAmountOrDate) geçsin diye
// alanları dolu üretir.
function repEvent(intent: LLMIntent) {
  return eventFromIntent(intent, { amount: 100000, date: '2026-07-15', reason: 'ödedim' });
}

// LLM'in gerçekten çağrıldığı durumlar ve oraya nasıl ulaşıldığı.
const REACH: Record<'identify' | 'remind' | 'negotiate' | 'confirm', LLMIntent[]> = {
  identify: [],
  remind: ['IDENTITY_CONFIRMED'],
  negotiate: ['IDENTITY_CONFIRMED', 'REFUSES'],
  confirm: ['IDENTITY_CONFIRMED', 'WILL_PAY'],
};

function actorAt(state: keyof typeof REACH) {
  const actor = startConversation(debtor);
  for (const intent of REACH[state]) {
    const ev = repEvent(intent);
    if (ev) actor.send(ev);
  }
  return actor;
}

describe('prompt ↔ machine intent drift', () => {
  // Prompt'un izin verdiği her intent (NO_RESPONSE hariç) makine tarafından O
  // durumda GERÇEKTEN işlenmeli — yoksa model üretir, makine sessizce yok sayar
  // (kilitlenme). Orijinal confirm/DISPUTES_DEBT hatası bu testle yakalanır.
  (['identify', 'remind', 'negotiate', 'confirm'] as const).forEach((state) => {
    it(`${state}: izin verilen tüm intent'ler makinede işleniyor`, () => {
      const actor = actorAt(state);
      expect(currentState(actor)).toBe(state);
      const snap = actor.getSnapshot();
      for (const intent of intentsForState(state)) {
        if (intent === 'NO_RESPONSE') continue; // stay-by-design, transition'sız
        const ev = repEvent(intent);
        expect(ev, `eventFromIntent(${intent}) null olmamalı`).not.toBeNull();
        expect(snap.can(ev!), `${state} durumu ${intent} intent'ini işlemeli`).toBe(true);
      }
    });
  });
});

describe('confirm durumunda fikir değişikliği', () => {
  function reachConfirm() {
    const actor = startConversation(debtor);
    actor.send({ type: 'IDENTITY_CONFIRMED' });
    actor.send({ type: 'WILL_PAY', amount: 100000, date: '2026-07-15' });
    expect(currentState(actor)).toBe('confirm');
    expect(actor.getSnapshot().context.outcome).toBe('PROMISE_TO_PAY');
    return actor;
  }

  it('itiraz → DISPUTE (PROMISE_TO_PAY üzerine yazılır)', () => {
    const actor = reachConfirm();
    actor.send({ type: 'DISPUTES_DEBT', reason: 'ödedim zaten' });
    expect(actor.getSnapshot().context.outcome).toBe('DISPUTE');
  });

  it('ret → REFUSED + söz temizlenir', () => {
    const actor = reachConfirm();
    actor.send({ type: 'REFUSES' });
    const ctx = actor.getSnapshot().context;
    expect(ctx.outcome).toBe('REFUSED');
    expect(ctx.promisedAmount).toBeNull();
    expect(ctx.promisedDate).toBeNull();
  });

  it('geri arama → CALLBACK_REQUESTED + söz temizlenir', () => {
    const actor = reachConfirm();
    actor.send({ type: 'ASKS_CALLBACK', callbackAt: '2026-08-01' });
    const ctx = actor.getSnapshot().context;
    expect(ctx.outcome).toBe('CALLBACK_REQUESTED');
    expect(ctx.promisedAmount).toBeNull();
  });
});

describe('ödeme sözü tutar/tarih guard', () => {
  it('tutar/tarih yoksa söz kilitlenmez (remind`de kalır, outcome null)', () => {
    const actor = startConversation(debtor);
    actor.send({ type: 'IDENTITY_CONFIRMED' });
    actor.send({ type: 'WILL_PAY' }); // alan yok
    expect(currentState(actor)).toBe('remind');
    expect(actor.getSnapshot().context.outcome).toBeNull();
  });

  it('sadece tarih varsa söz kilitlenir', () => {
    const actor = startConversation(debtor);
    actor.send({ type: 'IDENTITY_CONFIRMED' });
    actor.send({ type: 'WILL_PAY', date: '2026-07-20' });
    expect(currentState(actor)).toBe('confirm');
    expect(actor.getSnapshot().context.outcome).toBe('PROMISE_TO_PAY');
    expect(actor.getSnapshot().context.promisedDate).toBe('2026-07-20');
  });
});
