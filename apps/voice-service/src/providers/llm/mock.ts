import type { ILLMProvider, LLMRequest, LLMStructuredOutput } from '@voice/shared';

/**
 * Mock LLM: state'e göre "başarılı tahsilat" akışını ilerletir.
 *   identify → IDENTITY_CONFIRMED → remind → WILL_PAY → confirm → CONFIRMED → closing.
 * Gerçek sağlayıcı (OpenAI/Anthropic) eklenene kadar smoke test için yeterli.
 */
export class MockLLM implements ILLMProvider {
  readonly name = 'mock';

  async respond(req: LLMRequest): Promise<LLMStructuredOutput> {
    const { state, callContext } = req.context;
    const debtor = callContext.debtor;
    const amountTRY = (debtor.amountDue / 100).toFixed(2);
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10); // YYYY-MM-DD

    switch (state) {
      case 'greeting':
      case 'identify':
        return {
          say: `Merhaba, ${debtor.fullName} ile mi görüşüyorum?`,
          intent: 'IDENTITY_CONFIRMED',
        };
      case 'remind':
        return {
          say: `Vadesi geçmiş ${amountTRY} TL borcunuz görünüyor. Yarın ödeyebilir misiniz?`,
          intent: 'WILL_PAY',
          fields: { amount: debtor.amountDue, date: tomorrow },
        };
      case 'negotiate':
        return {
          say: `Yarın ${amountTRY} TL ödeyebilir misiniz?`,
          intent: 'WILL_PAY',
          fields: { amount: debtor.amountDue, date: tomorrow },
        };
      case 'confirm':
        return {
          say: `${amountTRY} TL yarın için kaydettim, teyit ediyor musunuz?`,
          intent: 'CONFIRMED',
        };
      case 'escalate':
        return {
          say: 'Sizi yetkili bir arkadaşımıza aktarıyorum, iyi günler.',
          intent: 'NO_RESPONSE',
        };
      case 'closing':
      default:
        return {
          say: 'Teşekkür ederim, iyi günler.',
          intent: 'NO_RESPONSE',
        };
    }
  }
}
