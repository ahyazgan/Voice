// =============================================================================
// parseFailure.test.ts — LLM bozuk çıktısında güvenli davranış
// =============================================================================
// LLM yapılandırılmış çıktısı parse edilemezse: tek seferlik hatada state'te
// kalıp tekrar sorarız (shouldHangup=false). Ama ART ARDA eşiği aşılırsa arama
// güvenli kapatılır (ESCALATED_TO_HUMAN) — müşteri sonsuza dek sıkışmaz.
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

/** Her zaman şema-dışı (geçersiz intent) çıktı döndürür → parse hep başarısız. */
class BrokenLLM implements ILLMProvider {
  readonly name = 'broken';
  calls = 0;
  async respond(_req: LLMRequest): Promise<LLMStructuredOutput> {
    this.calls++;
    // intent geçerli enum'da değil → LLMStructuredOutputSchema.safeParse başarısız.
    return { say: 'bir şeyler', intent: 'TOTALLY_BOGUS' } as unknown as LLMStructuredOutput;
  }
}

/** İlk tur bozuk, sonra geçerli IDENTITY_CONFIRMED döndürür (sayaç sıfırlanmalı). */
class RecoveringLLM implements ILLMProvider {
  readonly name = 'recovering';
  private idx = 0;
  async respond(_req: LLMRequest): Promise<LLMStructuredOutput> {
    const i = this.idx++;
    if (i === 0) return { say: '??', intent: 'NOPE' } as unknown as LLMStructuredOutput;
    return { say: 'Ayşe Hanım?', intent: 'IDENTITY_CONFIRMED' };
  }
}

function makeContext(): CallContext {
  const debtor: Debtor = {
    id: 'd1',
    fullName: 'Ayşe Demir',
    phoneE164: '+905551112233',
    amountDue: 125000,
    currency: 'TRY',
    dueDate: new Date('2026-04-01T00:00:00Z').toISOString(),
    invoiceRef: 'INV-42',
  };
  return {
    callId: 'call_parsefail',
    debtor,
    startedAt: new Date().toISOString(),
    consentToRecord: true,
  };
}

describe('TurnHandler — LLM parse hatası', () => {
  it('tek seferlik parse hatası: state korunur, kapanmaz, tekrar sorar', async () => {
    const turn = new TurnHandler(makeContext(), new BrokenLLM());
    const t1 = await turn.handleUserText('Alo?');
    expect(t1.state).toBe('identify'); // greeting→identify; ilerlemedi
    expect(t1.shouldHangup).toBe(false);
    expect(t1.reply).toContain('anlayamadım');
  });

  it('art arda parse hatası eşiği aşılınca güvenli kapatır (ESCALATED_TO_HUMAN)', async () => {
    const turn = new TurnHandler(makeContext(), new BrokenLLM());
    await turn.handleUserText('bir');
    await turn.handleUserText('iki');
    const t3 = await turn.handleUserText('üç'); // 3. art arda hata → eşik
    expect(t3.shouldHangup).toBe(true);
    expect(t3.outcome).toBe('ESCALATED_TO_HUMAN');
  });

  it('arada başarılı tur sayacı sıfırlar (sonsuz kapanma yok)', async () => {
    const turn = new TurnHandler(makeContext(), new RecoveringLLM());
    const t1 = await turn.handleUserText('Alo?'); // bozuk → fail #1
    expect(t1.shouldHangup).toBe(false);
    const t2 = await turn.handleUserText('Evet benim'); // geçerli → sayaç sıfır
    expect(t2.state).toBe('remind');
    expect(t2.shouldHangup).toBe(false);
  });
});
