import { z } from 'zod';
import type { CostRates } from './telemetry.js';

const EnvSchema = z.object({
  VOICE_WS_PORT: z.coerce.number().default(8787),
  /**
   * `platform` = Faz 1: orkestrasyon platformu (Retell/Vapi) ses akışını yürütür,
   *              voice-service yalnızca state machine + LLM turlarını çalıştırır.
   * `cascade`  = Faz 2: kendi STT/LLM/TTS cascade'imizi orkestre ederiz.
   */
  VOICE_MODE: z.enum(['platform', 'cascade']).default('platform'),
  ORCHESTRATION_PROVIDER: z.string().default('mock'),
  TELEPHONY_PROVIDER: z.string().default('mock'),
  STT_PROVIDER: z.string().default('mock'),
  TTS_PROVIDER: z.string().default('mock'),
  LLM_PROVIDER: z.string().default('mock'),

  // OpenAI (LLM_PROVIDER=openai ise OPENAI_API_KEY zorunlu).
  // Hız öncelikli: gpt-4o-mini (telefon konuşması için sweet spot).
  OPENAI_MODEL: z.string().default('gpt-4o-mini'),
  OPENAI_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.3),

  LOG_LEVEL: z.string().default('info'),

  // API base URL — finalize özetini buraya POST ederiz. Boşsa persist atlanır.
  API_BASE_URL: z.string().url().optional(),

  // --- Maliyet fiyatları (TRY/birim) ---
  // Hepsi 0 ise telemetri totalTRY=0 döner. Gerçek değerleri sağlayıcı faturalarından doldur.
  COST_TELEPHONY_PER_MIN_TRY: z.coerce.number().nonnegative().default(0),
  COST_STT_PER_MIN_TRY: z.coerce.number().nonnegative().default(0),
  COST_TTS_PER_CHAR_TRY: z.coerce.number().nonnegative().default(0),
  COST_LLM_IN_PER_1K_TOK_TRY: z.coerce.number().nonnegative().default(0),
  COST_LLM_OUT_PER_1K_TOK_TRY: z.coerce.number().nonnegative().default(0),
});

export type Env = z.infer<typeof EnvSchema>;

export const env: Env = EnvSchema.parse(process.env);

/**
 * Telemetri için CostRates. Hepsi 0 ise `undefined` dönüp telemetry maliyet
 * hesabını atlar (toplam=0 log'lanır). En az biri 0'dan büyükse rates aktiftir.
 */
export function getCostRates(): CostRates | undefined {
  const rates: CostRates = {
    telephonyPerMinTRY: env.COST_TELEPHONY_PER_MIN_TRY,
    sttPerMinTRY: env.COST_STT_PER_MIN_TRY,
    ttsPerCharTRY: env.COST_TTS_PER_CHAR_TRY,
    llmInPer1kTokTRY: env.COST_LLM_IN_PER_1K_TOK_TRY,
    llmOutPer1kTokTRY: env.COST_LLM_OUT_PER_1K_TOK_TRY,
  };
  const anySet = Object.values(rates).some((v) => v > 0);
  return anySet ? rates : undefined;
}
