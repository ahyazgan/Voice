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
  // 0.3 çok düşüktü → her arama neredeyse aynı kelimelerle (robotik). 0.55 doğal
  // Türkçe çeşitliliği verir, yapılandırılmış çıktı (JSON schema) yine bağlar.
  OPENAI_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.55),

  // Deepgram (STT_PROVIDER=deepgram ise DEEPGRAM_API_KEY zorunlu).
  // Türkçe telefon STT: nova-2 modeli, μ-law/8000. interim_results→barge-in,
  // utterance_end/speech_final→tur sonu.
  DEEPGRAM_MODEL: z.string().default('nova-2'),
  DEEPGRAM_LANGUAGE: z.string().default('tr'),
  // Endpointing: kaç ms sessizlik konuşma sonu sayılır. 300ms TR için erkendi —
  // müşteri cümle ortasında ("şey... yani...") duraksayınca AI araya giriyordu.
  // 550ms daha doğal: insan da konuşmacının bitirmesini bekler.
  DEEPGRAM_ENDPOINTING_MS: z.coerce.number().int().nonnegative().default(550),
  DEEPGRAM_UTTERANCE_END_MS: z.coerce.number().int().nonnegative().default(1000),
  // Müşteri hiç cevap vermezse: bu kadar ms sonra AI "Alo, orada mısınız?" der;
  // ikinci kez de sessizlikse aramayı kapatır (sonsuz bekleme önlenir).
  SILENCE_PROMPT_MS: z.coerce.number().int().positive().default(8000),

  // Retell (ORCHESTRATION_PROVIDER=retell ise RETELL_API_KEY + agent zorunlu).
  // Retell aramayı yürütür; her müşteri turunda Custom-LLM WS üzerinden bize bağlanır.
  // RETELL_AGENT_ID: Retell panelinde oluşturulmuş, llm_websocket_url'i bizim
  //   /llm-websocket/{call_id} adresimize işaret eden agent.
  // RETELL_FROM_NUMBER: Retell'e tanımlı giden arama numarası (TR yerel olmalı; bkz. telnyx notu).
  RETELL_AGENT_ID: z.string().optional(),
  RETELL_FROM_NUMBER: z.string().optional(),

  // Vapi (ORCHESTRATION_PROVIDER=vapi ise VAPI_API_KEY + assistant + numara zorunlu).
  // Vapi Custom-LLM modunda assistant, model.url'i bizim /vapi-llm/{callId}/chat/
  // completions adresimize işaret eder; OpenAI-uyumlu chat-completion bekler.
  VAPI_ASSISTANT_ID: z.string().optional(),
  VAPI_PHONE_NUMBER_ID: z.string().optional(),

  // ElevenLabs (TTS_PROVIDER=elevenlabs ise ELEVENLABS_API_KEY zorunlu).
  // ⚠️ VOICE ID: Varsayılan '21m00Tcm4TlvDq8ikWAM' (Rachel) İNGİLİZCE bir sestir —
  // Türkçe metni İngilizce sese okutmak doğallığı yok eder (#1 robotiklik kaynağı).
  // ÜRETİMDEN ÖNCE Türkçe-native bir ses seç ve ELEVENLABS_VOICE_ID'yi onunla doldur:
  // https://elevenlabs.io/app/voice-library → dil filtresi "Turkish" → telefonda yan yana dinle.
  ELEVENLABS_VOICE_ID: z.string().default('21m00Tcm4TlvDq8ikWAM'),
  // multilingual_v2 = Türkçe'de turbo'dan DAHA DOĞAL (fonem/prozodi), ~2x yavaş.
  // Doğallık ürünün farklılaştırıcısı olduğundan varsayılan bu; gecikme sorunsa
  // eleven_turbo_v2_5'e (hız ~300ms) düş ve telefon kalitesinde yan yana dinle.
  ELEVENLABS_MODEL: z.string().default('eleven_multilingual_v2'),
  // Telefon (8kHz) için biraz daha tutarlı/net: stability 0.5→0.6, similarity 0.75→0.7.
  ELEVENLABS_STABILITY: z.coerce.number().min(0).max(1).default(0.6),
  ELEVENLABS_SIMILARITY: z.coerce.number().min(0).max(1).default(0.7),

  // Ajan kimliği (prompt + rıza anonsunda kullanılır). İnsan kendini tanıtır;
  // jenerik "Tahsilat Asistanı" yerine gerçek bir isim + işletme adı daha doğal.
  AGENT_NAME: z.string().default('Zeynep'),
  COMPANY_NAME: z.string().default('işletmemiz'),

  LOG_LEVEL: z.string().default('info'),

  // API base URL — finalize özetini buraya POST ederiz. Boşsa persist atlanır.
  API_BASE_URL: z.string().url().optional(),
  // API'nin finalize endpoint'ini koruyan paylaşılan sır (x-internal-secret).
  // API tarafındaki INTERNAL_API_SECRET ile AYNI olmalı.
  INTERNAL_API_SECRET: z.string().optional(),

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
