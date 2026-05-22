// =============================================================================
// turnHandler.smoke.test.ts — uçtan uca senaryo doğrulaması (infra'sız)
// =============================================================================
// LLM'i scripted bir mock ile değiştirip TurnHandler'ı gerçek bir konuşma
// gibi sürüyoruz. Her senaryoda: state geçişleri + final outcome +
// shouldHangup + (önemli) state machine pazarlık limiti gibi GİZLİ kurallar
// doğru çalışıyor mu kontrol ediyoruz.
//
// Bu test gerçek LLM çağırmaz — yalnızca state machine + TurnHandler +
// intent eşleme + prompt-machine drift sınırlarını sınar. Pipeline'ın en
// olası kırılma noktaları.
// =============================================================================

import { describe, it, expect } from 'vitest';
import type {
  CallContext,
  Debtor,
  ILLMProvider,
  LLMRequest,
  LLMStructuredOutput,
} from '@voice/shared';
import { TurnHandler } from '../turnHandler.js';

class ScriptedLLM implements ILLMProvider {
  readonly name = 'scripted';
  private idx = 0;
  constructor(private readonly responses: readonly LLMStructuredOutput[]) {}
  async respond(_req: LLMRequest): Promise<LLMStructuredOutput> {
    const r = this.responses[this.idx++];
    if (!r) throw new Error(`scripted LLM exhausted at turn ${this.idx}`);
    return r;
  }
}

function makeDebtor(): Debtor {
  return {
    id: 'd1',
    fullName: 'Ayşe Demir',
    phoneE164: '+905551112233',
    amountDue: 125000, // 1.250,00 TL kuruş
    currency: 'TRY',
    dueDate: new Date('2026-04-01T00:00:00Z').toISOString(),
    invoiceRef: 'INV-42',
  };
}

function makeContext(): CallContext {
  return {
    callId: 'call_test_1',
    debtor: makeDebtor(),
    startedAt: new Date().toISOString(),
    consentToRecord: true,
  };
}

describe('TurnHandler — collections flow smoke', () => {
  it('happy path: identity → remind → will_pay → confirm → closing (PROMISE_TO_PAY)', async () => {
    const llm = new ScriptedLLM([
      { say: 'Ayşe Hanım ile mi görüşüyorum?', intent: 'IDENTITY_CONFIRMED' },
      {
        say: '1.250,00 TL borcunuz var, yarın ödeyebilir misiniz?',
        intent: 'WILL_PAY',
        fields: { amount: 125000, date: '2026-04-15' },
      },
      { say: '1.250,00 TL yarın için kaydettim, teyit ediyor musunuz?', intent: 'CONFIRMED' },
    ]);
    const turn = new TurnHandler(makeContext(), llm);

    const t1 = await turn.handleUserText('Evet, benim');
    expect(t1.state).toBe('remind');
    expect(t1.shouldHangup).toBe(false);

    const t2 = await turn.handleUserText('Tamam yarın öderim');
    expect(t2.state).toBe('confirm');
    expect(t2.outcome).toBe('PROMISE_TO_PAY');

    const t3 = await turn.handleUserText('Evet onaylıyorum');
    expect(t3.state).toBe('closing');
    expect(t3.shouldHangup).toBe(true);
    expect(t3.outcome).toBe('PROMISE_TO_PAY');
    expect(turn.outcome).toBe('PROMISE_TO_PAY');
  });

  it('wrong person at identify → WRONG_NUMBER, kapanır', async () => {
    const llm = new ScriptedLLM([
      { say: 'Anladım, rahatsız ettiğim için özür dilerim.', intent: 'WRONG_PERSON' },
    ]);
    const turn = new TurnHandler(makeContext(), llm);

    const t1 = await turn.handleUserText('Hayır, yanlış numara');
    expect(t1.state).toBe('closing');
    expect(t1.shouldHangup).toBe(true);
    expect(t1.outcome).toBe('WRONG_NUMBER');
  });

  it('iki kez REFUSES → pazarlık limiti dolar, REFUSED outcome', async () => {
    // remind'de REFUSES → negotiate'e geçer (bumpAttempt = 1).
    // negotiate'de REFUSES → bumpAttempt = 2 → always guard kapatır, outcome REFUSED.
    const llm = new ScriptedLLM([
      { say: 'Ayşe Hanım ile mi görüşüyorum?', intent: 'IDENTITY_CONFIRMED' },
      { say: 'Borcunuzu hatırlatmak istiyorum.', intent: 'REFUSES' },
      { say: 'Belki bir tarih önerebilirsiniz?', intent: 'REFUSES' },
    ]);
    const turn = new TurnHandler(makeContext(), llm);

    await turn.handleUserText('Evet benim');
    await turn.handleUserText('Ödemem'); // 1. red → negotiate
    const t3 = await turn.handleUserText('Yok param, ödemem'); // 2. red → kapat

    expect(t3.state).toBe('closing');
    expect(t3.shouldHangup).toBe(true);
    expect(t3.outcome).toBe('REFUSED');
  });

  it('DISPUTES_DEBT → escalate → closing, outcome DISPUTE (insan müdahalesi)', async () => {
    const llm = new ScriptedLLM([
      { say: 'Ayşe Hanım ile mi görüşüyorum?', intent: 'IDENTITY_CONFIRMED' },
      {
        say: 'Konuyu yetkili arkadaşıma iletiyorum.',
        intent: 'DISPUTES_DEBT',
        fields: { reason: 'Bu borcu zaten ödedim' },
      },
    ]);
    const turn = new TurnHandler(makeContext(), llm);

    await turn.handleUserText('Evet benim');
    const t2 = await turn.handleUserText('Bu borcu ödedim, kabul etmiyorum');

    // escalate state'i always ile closing'e atlar; entry ile outcome korunur (DISPUTE).
    expect(t2.state).toBe('closing');
    expect(t2.shouldHangup).toBe(true);
    expect(t2.outcome).toBe('DISPUTE');
  });

  it('GETS_ANGRY herhangi yerden → ESCALATED_TO_HUMAN', async () => {
    const llm = new ScriptedLLM([
      { say: 'Ayşe Hanım ile mi görüşüyorum?', intent: 'IDENTITY_CONFIRMED' },
      { say: 'Sizi yetkili bir arkadaşıma aktarıyorum.', intent: 'GETS_ANGRY' },
    ]);
    const turn = new TurnHandler(makeContext(), llm);

    await turn.handleUserText('Evet benim');
    const t2 = await turn.handleUserText('BANA NEDEN SÜREKLİ ARIYORSUNUZ!');

    expect(t2.state).toBe('closing');
    expect(t2.shouldHangup).toBe(true);
    expect(t2.outcome).toBe('ESCALATED_TO_HUMAN');
  });

  it('PARTIAL_OR_PLAN remind\'de → negotiate\'e geçer, ikinci turda WILL_PAY → confirm', async () => {
    const llm = new ScriptedLLM([
      { say: 'Ayşe Hanım ile mi görüşüyorum?', intent: 'IDENTITY_CONFIRMED' },
      {
        say: 'Anlıyorum, taksit önerebilirim.',
        intent: 'PARTIAL_OR_PLAN',
        fields: { amount: 60000, date: '2026-04-20' },
      },
      {
        say: 'Yarın yarısını ödeyebilir misiniz?',
        intent: 'WILL_PAY',
        fields: { amount: 60000, date: '2026-04-20' },
      },
      { say: 'Teyit ediyor musunuz?', intent: 'CONFIRMED' },
    ]);
    const turn = new TurnHandler(makeContext(), llm);

    await turn.handleUserText('Evet benim');
    const t2 = await turn.handleUserText('Tamamını veremem, taksit yapabilir miyim?');
    expect(t2.state).toBe('negotiate');

    const t3 = await turn.handleUserText('20 Nisanda yarısını ödeyeyim');
    expect(t3.state).toBe('confirm');
    expect(t3.outcome).toBe('PROMISE_TO_PAY');

    const t4 = await turn.handleUserText('Onaylıyorum');
    expect(t4.state).toBe('closing');
    expect(t4.shouldHangup).toBe(true);
    expect(t4.outcome).toBe('PROMISE_TO_PAY');
  });
});
