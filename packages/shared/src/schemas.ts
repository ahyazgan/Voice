import { z } from 'zod';

export const DebtorSchema = z.object({
  id: z.string(),
  fullName: z.string().min(1),
  phoneE164: z.string().regex(/^\+\d{8,15}$/),
  amountDue: z.number().int().nonnegative(),
  currency: z.literal('TRY'),
  dueDate: z.string().datetime(),
  invoiceRef: z.string().optional(),
});

export const CallOutcomeSchema = z.enum([
  'PROMISE_TO_PAY',
  'DISPUTE',
  'WRONG_NUMBER',
  'NO_ANSWER',
  'CALLBACK_REQUESTED',
  'ESCALATED_TO_HUMAN',
  'REFUSED',
]);

export const LLMIntentSchema = z.enum([
  'IDENTITY_CONFIRMED',
  'WRONG_PERSON',
  'WILL_PAY',
  'PARTIAL_OR_PLAN',
  'DISPUTES_DEBT',
  'REFUSES',
  'ASKS_CALLBACK',
  'GETS_ANGRY',
  'CONFIRMED',
  'NO_RESPONSE',
]);

/** YYYY-MM-DD veya tam ISO 8601 datetime kabul eden esnek tarih şeması. */
const isoDateLike = z.string().regex(
  /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/,
  'YYYY-MM-DD veya tam ISO 8601 datetime bekleniyor',
);

export const LLMStructuredOutputSchema = z.object({
  say: z.string().min(1),
  intent: LLMIntentSchema,
  fields: z
    .object({
      amount: z.number().int().nonnegative().optional(),
      date: isoDateLike.optional(),
      reason: z.string().optional(),
    })
    .optional(),
  // Maliyet telemetrisi taşıma alanı (LLM şemasının parçası değil; provider ekler).
  usage: z
    .object({
      tokensIn: z.number().int().nonnegative(),
      tokensOut: z.number().int().nonnegative(),
    })
    .optional(),
});

export const TranscriptTurnSchema = z.object({
  speaker: z.enum(['agent', 'customer', 'system']),
  text: z.string(),
  at: z.string().datetime(),
  latencyMs: z.number().nonnegative().optional(),
});
