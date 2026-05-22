// =============================================================================
// scripts/test-openai-turn.ts — gerçek OpenAI çağrısı (infra'sız)
// =============================================================================
// .env'den OPENAI_API_KEY okur, her durum için bir kullanıcı sözüne karşı
// gerçek gpt-4o-mini cevabını alır ve yapılandırılmış çıktıyı print eder.
//
// Çalıştırma (repo kökünden):
//   node --env-file=.env --import tsx apps/voice-service/scripts/test-openai-turn.ts
// veya:
//   pnpm --filter @voice/voice-service openai:test
// =============================================================================

import type { CallContext, ConversationState, Debtor } from '@voice/shared';
import { OpenAILLM } from '../src/providers/llm/openai.js';
import { promptForState } from '../src/prompts/index.js';

function ensureKey(): string {
  const k = process.env.OPENAI_API_KEY;
  if (!k) {
    console.error('OPENAI_API_KEY eksik. node --env-file=.env ... ile çalıştırın.');
    process.exit(1);
  }
  return k;
}

const debtor: Debtor = {
  id: 'd1',
  fullName: 'Ayşe Demir',
  phoneE164: '+905551112233',
  amountDue: 125000,
  currency: 'TRY',
  dueDate: new Date('2026-04-01T00:00:00Z').toISOString(),
  invoiceRef: 'INV-42',
};

const ctx: CallContext = {
  callId: 'call_openai_test_1',
  debtor,
  startedAt: new Date().toISOString(),
  consentToRecord: true,
};

interface Probe {
  state: ConversationState;
  userText: string;
  history?: { speaker: 'agent' | 'customer'; text: string }[];
}

const probes: Probe[] = [
  { state: 'identify', userText: 'Alo, evet benim' },
  { state: 'identify', userText: 'Hayır yanlış numara çevirmişsiniz' },
  {
    state: 'remind',
    userText: 'Tamam, ne kadar borcum var?',
    history: [{ speaker: 'agent', text: 'Ayşe Hanım ile mi görüşüyorum?' }],
  },
  {
    state: 'remind',
    userText: 'Yarın ödeyebilirim, 1250 lirayı yatırırım',
    history: [{ speaker: 'agent', text: '1250 TL borcunuz görünüyor.' }],
  },
  {
    state: 'remind',
    userText: 'Ben bu borcu ödemiştim, kabul etmiyorum',
    history: [{ speaker: 'agent', text: '1250 TL borcunuz görünüyor.' }],
  },
  {
    state: 'negotiate',
    userText: 'Şu an param yok, ay sonu öderim',
    history: [{ speaker: 'agent', text: 'Tamamını veremezseniz bir plan yapabiliriz.' }],
  },
  {
    state: 'confirm',
    userText: 'Evet doğru, yarın yatırırım',
    history: [{ speaker: 'agent', text: '1250 TL yarın için kaydettim, teyit ediyor musunuz?' }],
  },
];

async function main() {
  const llm = new OpenAILLM({ apiKey: ensureKey() });
  console.log(`Model: ${process.env.OPENAI_MODEL ?? 'gpt-4o-mini'}`);
  console.log('='.repeat(72));

  for (const [i, p] of probes.entries()) {
    const t0 = Date.now();
    const history = (p.history ?? []).map((h) => ({
      speaker: h.speaker,
      text: h.text,
      at: new Date().toISOString(),
    }));

    const out = await llm.respond({
      systemPrompt: promptForState(p.state, debtor),
      context: { callContext: ctx, state: p.state, history },
      userText: p.userText,
    });
    const ms = Date.now() - t0;

    console.log(`\n[${i + 1}] state=${p.state}  user="${p.userText}"  (${ms}ms)`);
    console.log(`    intent: ${out.intent}`);
    console.log(`    say   : ${out.say}`);
    if (out.fields) console.log(`    fields: ${JSON.stringify(out.fields)}`);
  }

  console.log('\n' + '='.repeat(72));
  console.log('Bitti. Türkçe ton + intent doğruluğu beklendiği gibi mi?');
}

main().catch((err) => {
  console.error('HATA:', err);
  process.exit(1);
});
