// =============================================================================
// intentDrift.test.ts — INTENT-DRIFT KORUMASI (Katman 0)
// =============================================================================
// Üç kaynak birbiriyle KENETLİ olmalı, yoksa akış sessizce kırılır:
//   1) intentsForState (prompts) — modelin üretmesine İZİN verilen intent'ler
//   2) LLMIntentSchema (shared)  — turnHandler'ın çıktıyı DOĞRULADIĞI şema
//   3) eventFromIntent (stateMachine) — intent'i state-makine olayına ÇEVİREN
// Drift örneği (yakalanan gerçek hata): CONSENT_DECLINED prompt+OpenAI enum'unda
// vardı ama LLMIntentSchema'da yoktu → KVKK kayıt reddi işlenmiyordu.
// =============================================================================

import { describe, it, expect } from 'vitest';
import type { ConversationState } from '@voice/shared';
import { LLMIntentSchema } from '@voice/shared';
import { intentsForState } from '../prompts/index.js';
import { eventFromIntent } from '../stateMachine.js';

const ALL_STATES: ConversationState[] = [
  'greeting', 'identify', 'remind', 'negotiate', 'confirm', 'escalate', 'closing',
];

const schemaIntents = new Set<string>(LLMIntentSchema.options);

describe('intent-drift koruması', () => {
  it("prompt'un izin verdiği HER intent LLMIntentSchema'da olmalı (validator reddetmesin)", () => {
    for (const state of ALL_STATES) {
      for (const intent of intentsForState(state)) {
        expect(
          schemaIntents.has(intent),
          `intent "${intent}" (state: ${state}) LLMIntentSchema'da yok → çıktı reddedilir`,
        ).toBe(true);
      }
    }
  });

  it("LLMIntentSchema'daki HER intent eventFromIntent ile bir olaya çevrilebilmeli", () => {
    for (const intent of LLMIntentSchema.options) {
      const event = eventFromIntent(intent);
      expect(event, `intent "${intent}" eventFromIntent ile map'lenemiyor`).not.toBeNull();
      expect(event?.type).toBe(intent);
    }
  });

  it('CONSENT_DECLINED zinciri uçtan uca bağlı (KVKK regresyon kilidi)', () => {
    expect(schemaIntents.has('CONSENT_DECLINED')).toBe(true);
    expect(intentsForState('identify')).toContain('CONSENT_DECLINED');
    expect(eventFromIntent('CONSENT_DECLINED')).toEqual({ type: 'CONSENT_DECLINED' });
  });
});
