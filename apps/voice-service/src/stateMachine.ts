// =============================================================================
// stateMachine.ts — TAHSİLAT KONUŞMA DURUM MAKİNESİ (XState v5)
// =============================================================================
// Bu dosya ürünün BEYNİDİR. Genel "sesli asistan"dan ayrıştığımız yer burası:
// itiraz yönetimi, ödeme planı pazarlığı, yasal sınırlar, ödeme sözü takibi.
//
// İLKE: LLM serbest konuşmaz. Her durum, LLM'in üretebileceği INTENT'leri kısıtlar.
// Durum geçişi LLM'in YAPILANDIRILMIŞ çıktısındaki intent+fields ile tetiklenir,
// metin yorumuyla DEĞİL. Böylece AI saçmalayamaz, akış denetlenebilir kalır.
// =============================================================================

import { setup, assign, createActor, type ActorRefFrom } from 'xstate';
import type { CallOutcome, ConversationState, Debtor, LLMIntent } from '@voice/shared';

/**
 * Zod `.optional()` `T | undefined` üretir; LLMStructuredOutput['fields'] strict
 * optional (`T?`) kullanır. `exactOptionalPropertyTypes:true` altında ikisi uyuşmaz,
 * bu yüzden burada Zod'a tolerant local tip kullanıyoruz.
 */
type LooseFields = {
  amount?: number | undefined;
  date?: string | undefined;
  reason?: string | undefined;
};

// --- Konuşma boyunca biriken bağlam ----------------------------------------
interface CollectionsContext {
  debtor: Debtor;
  outcome: CallOutcome | null;
  promisedAmount: number | null;
  promisedDate: string | null;
  identityVerified: boolean;
  attemptCount: number;
  disputeReason: string | null;
}

// --- LLM'in üretebileceği INTENT'ler (durum geçiş olayları) ------------------
export type CollectionsEvent =
  | { type: 'IDENTITY_CONFIRMED' }
  | { type: 'WRONG_PERSON' }
  | { type: 'WILL_PAY'; amount?: number; date?: string }
  | { type: 'PARTIAL_OR_PLAN'; amount?: number; date?: string }
  | { type: 'DISPUTES_DEBT'; reason?: string }
  | { type: 'REFUSES' }
  | { type: 'ASKS_CALLBACK'; callbackAt?: string }
  | { type: 'GETS_ANGRY' }
  | { type: 'CONFIRMED' }
  | { type: 'NO_RESPONSE' };

// Yasal/etik sınır: aynı aramada pazarlık denemesi üst limiti.
// Bunun ötesinde ısrar TACİZ sayılabilir → kibarca kapat. (TR tahsilat etiği)
const MAX_NEGOTIATION_ATTEMPTS = 2;

export function createCollectionsMachine(debtor: Debtor) {
  return setup({
    types: {
      context: {} as CollectionsContext,
      events: {} as CollectionsEvent,
    },
    actions: {
      verifyIdentity: assign({ identityVerified: true }),
      recordPromise: assign(({ event }) => {
        if (event.type === 'WILL_PAY' || event.type === 'PARTIAL_OR_PLAN') {
          return {
            promisedAmount: event.amount ?? null,
            promisedDate: event.date ?? null,
          };
        }
        return {};
      }),
      recordDispute: assign(({ event }) =>
        event.type === 'DISPUTES_DEBT'
          ? { disputeReason: event.reason ?? 'belirtilmedi' }
          : {},
      ),
      bumpAttempt: assign(({ context }) => ({ attemptCount: context.attemptCount + 1 })),
      setOutcome: assign(({ event }) => ({ outcome: outcomeForEvent(event) })),
    },
    guards: {
      negotiationExhausted: ({ context }) => context.attemptCount >= MAX_NEGOTIATION_ATTEMPTS,
    },
  }).createMachine({
    id: 'collections',
    initial: 'greeting',
    context: {
      debtor,
      outcome: null,
      promisedAmount: null,
      promisedDate: null,
      identityVerified: false,
      attemptCount: 0,
      disputeReason: null,
    },
    states: {
      // --- 1. SELAM + KAYIT RIZASI -------------------------------------------
      // KVKK: arama kaydı rıza anonsu burada (orchestrator CONSENT_ANNOUNCEMENT seslendirir).
      // Kimliği doğrulamadan borç DETAYI PAYLAŞMA (yanlış kişiye ifşa = ihlal).
      // Bu state, anons sonrası anında identify'a geçer; LLM ilk turunda identify
      // promptuyla konuşur.
      greeting: {
        always: { target: 'identify' },
      },

      // --- 2. KİMLİK DOĞRULAMA -----------------------------------------------
      identify: {
        on: {
          IDENTITY_CONFIRMED: { target: 'remind', actions: 'verifyIdentity' },
          WRONG_PERSON: { target: 'closing', actions: 'setOutcome' },
          ASKS_CALLBACK: { target: 'closing', actions: 'setOutcome' },
          GETS_ANGRY: 'escalate',
          NO_RESPONSE: 'closing',
        },
      },

      // --- 3. BORÇ HATIRLATMA -------------------------------------------------
      remind: {
        on: {
          WILL_PAY: { target: 'confirm', actions: ['recordPromise', 'setOutcome'] },
          PARTIAL_OR_PLAN: { target: 'negotiate', actions: 'recordPromise' },
          DISPUTES_DEBT: { target: 'escalate', actions: ['recordDispute', 'setOutcome'] },
          REFUSES: { target: 'negotiate', actions: 'bumpAttempt' },
          ASKS_CALLBACK: { target: 'closing', actions: 'setOutcome' },
          GETS_ANGRY: 'escalate',
          NO_RESPONSE: 'closing',
        },
      },

      // --- 4. PAZARLIK (ödeme planı / kısmi) ---------------------------------
      // Yasal sınır: MAX_NEGOTIATION_ATTEMPTS aşılırsa pazarlığı bırak.
      // DÜZELTME: setOutcome event'e bakar; 'always' kendi tetiklediği için event
      // REFUSES değildir → outcome yanlış map'lenirdi. İnline assign ile REFUSED yazıyoruz.
      negotiate: {
        always: [
          {
            guard: 'negotiationExhausted',
            target: 'closing',
            actions: assign({ outcome: 'REFUSED' as CallOutcome }),
          },
        ],
        on: {
          WILL_PAY: { target: 'confirm', actions: ['recordPromise', 'setOutcome'] },
          PARTIAL_OR_PLAN: { target: 'confirm', actions: ['recordPromise', 'setOutcome'] },
          DISPUTES_DEBT: { target: 'escalate', actions: ['recordDispute', 'setOutcome'] },
          REFUSES: { actions: 'bumpAttempt' },
          GETS_ANGRY: 'escalate',
          ASKS_CALLBACK: { target: 'closing', actions: 'setOutcome' },
          NO_RESPONSE: 'closing',
        },
      },

      // --- 5. TEYİT (ödeme sözü kilitle) -------------------------------------
      confirm: {
        on: {
          CONFIRMED: { target: 'closing' },
          PARTIAL_OR_PLAN: { actions: 'recordPromise' },
          GETS_ANGRY: 'escalate',
          NO_RESPONSE: 'closing',
        },
      },

      // --- 6. İNSANA AKTAR ---------------------------------------------------
      escalate: {
        entry: assign(({ context }) => ({
          outcome: context.outcome ?? ('ESCALATED_TO_HUMAN' as CallOutcome),
        })),
        always: { target: 'closing' },
      },

      // --- 7. KAPANIŞ (final) ------------------------------------------------
      closing: {
        type: 'final',
        entry: assign(({ context }) => ({
          outcome: context.outcome ?? ('NO_ANSWER' as CallOutcome),
        })),
      },
    },
  });
}

// --- Olay → CallOutcome eşlemesi --------------------------------------------
function outcomeForEvent(event: CollectionsEvent): CallOutcome {
  switch (event.type) {
    case 'WILL_PAY':
    case 'PARTIAL_OR_PLAN':
      return 'PROMISE_TO_PAY';
    case 'DISPUTES_DEBT':
      return 'DISPUTE';
    case 'WRONG_PERSON':
      return 'WRONG_NUMBER';
    case 'ASKS_CALLBACK':
      return 'CALLBACK_REQUESTED';
    case 'GETS_ANGRY':
      return 'ESCALATED_TO_HUMAN';
    case 'REFUSES':
      return 'REFUSED';
    default:
      return 'NO_ANSWER';
  }
}

// --- Aktör + yardımcılar (TurnHandler / Orchestrator buradan tüketir) -------

export type ConversationActor = ActorRefFrom<ReturnType<typeof createCollectionsMachine>>;

export function startConversation(debtor: Debtor): ConversationActor {
  const actor = createActor(createCollectionsMachine(debtor));
  actor.start();
  return actor as ConversationActor;
}

export function currentState(actor: ConversationActor): ConversationState {
  return actor.getSnapshot().value as ConversationState;
}

/**
 * LLM yapılandırılmış çıktısını CollectionsEvent'e çevirir.
 * Bilinmeyen / map'lenemez intent → null (state machine'e gönderme).
 */
/**
 * LLM yapılandırılmış çıktısının `fields` bloğunu CollectionsEvent'e çevirir.
 * - amount → WILL_PAY/PARTIAL_OR_PLAN.amount (kuruş)
 * - date   → WILL_PAY/PARTIAL_OR_PLAN.date VEYA ASKS_CALLBACK.callbackAt
 * - reason → DISPUTES_DEBT.reason
 */
export function eventFromIntent(
  intent: LLMIntent,
  fields?: LooseFields,
): CollectionsEvent | null {
  switch (intent) {
    case 'IDENTITY_CONFIRMED':
      return { type: 'IDENTITY_CONFIRMED' };
    case 'WRONG_PERSON':
      return { type: 'WRONG_PERSON' };
    case 'WILL_PAY':
      return {
        type: 'WILL_PAY',
        ...(fields?.amount !== undefined && { amount: fields.amount }),
        ...(fields?.date !== undefined && { date: fields.date }),
      };
    case 'PARTIAL_OR_PLAN':
      return {
        type: 'PARTIAL_OR_PLAN',
        ...(fields?.amount !== undefined && { amount: fields.amount }),
        ...(fields?.date !== undefined && { date: fields.date }),
      };
    case 'DISPUTES_DEBT':
      return {
        type: 'DISPUTES_DEBT',
        ...(fields?.reason !== undefined && { reason: fields.reason }),
      };
    case 'REFUSES':
      return { type: 'REFUSES' };
    case 'ASKS_CALLBACK':
      return {
        type: 'ASKS_CALLBACK',
        ...(fields?.date !== undefined && { callbackAt: fields.date }),
      };
    case 'GETS_ANGRY':
      return { type: 'GETS_ANGRY' };
    case 'CONFIRMED':
      return { type: 'CONFIRMED' };
    case 'NO_RESPONSE':
      return { type: 'NO_RESPONSE' };
    default:
      return null;
  }
}
