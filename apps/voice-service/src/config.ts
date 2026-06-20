import { z } from 'zod';
import { timingSafeEqual } from 'node:crypto';
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
  // Retell event webhook (call_ended vb.) imza doğrulaması için API key.
  // Retell panelinde "webhook badge"li key; verilmezse RETELL_API_KEY'e düşer.
  // Tanımlıysa /retell-webhook imzasız/geçersiz POST'u reddeder.
  RETELL_API_KEY: z.string().optional(),
  RETELL_WEBHOOK_API_KEY: z.string().optional(),

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

  // --- Auth (üretimde ZORUNLU; bkz. assertProductionSafe) ---
  // `/control` WS'ine "arama başlat" frame'i atan worker'ın paylaşması gereken sır.
  // Boş bırakılırsa control WS herkese açık olur → ağdan erişen herkes arama
  // başlatabilir (yanlış kişiyi arama / maliyet saldırısı). Worker (apps/api)
  // CONTROL_AUTH_SECRET ile AYNI değeri taşır. Varsayılan: INTERNAL_API_SECRET'a düşer.
  CONTROL_AUTH_SECRET: z.string().optional(),
  // Vapi Custom-LLM POST'larını doğrulamak için Vapi'nin "Server Secret"ı.
  // Vapi her isteğe `x-vapi-secret` header'ı ekler; bununla karşılaştırılır.
  // Boşsa Vapi POST'ları doğrulanmaz (sahte tur enjeksiyonu riski).
  VAPI_SECRET: z.string().optional(),
  NODE_ENV: z.string().optional(),

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

/** `/control` WS'ini koruyan sır. CONTROL_AUTH_SECRET öncelikli, yoksa INTERNAL_API_SECRET. */
export function controlAuthSecret(): string | undefined {
  return env.CONTROL_AUTH_SECRET ?? env.INTERNAL_API_SECRET;
}

/** Retell webhook imzasını doğrulayan key. Webhook-badge'li key öncelikli. */
export function retellWebhookKey(): string | undefined {
  return env.RETELL_WEBHOOK_API_KEY ?? env.RETELL_API_KEY;
}

/**
 * İki sırrı sabit-zamanlı karşılaştırır (zamanlama sızıntısı yok). Uzunluk farkı
 * da güvenli ele alınır. Biri boş/undefined ise false.
 */
export function secretsMatch(provided: string | undefined, expected: string | undefined): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Üretimde (NODE_ENV=production) tehlikeli varsayılanları reddet. Sessizce mock'a
 * düşüp gerçek müşterileri arama / kimliksiz endpoint açma / İngilizce sesle
 * Türkçe konuşma gibi felaketleri başlamadan durdurur. Dev/test'te no-op.
 */
export function assertProductionSafe(): void {
  if (env.NODE_ENV !== 'production') return;
  const errs: string[] = [];

  if (env.VOICE_MODE === 'platform') {
    if (env.ORCHESTRATION_PROVIDER === 'mock')
      errs.push('ORCHESTRATION_PROVIDER=mock üretimde olamaz (retell/vapi seç).');
  } else {
    for (const [k, v] of [
      ['TELEPHONY_PROVIDER', env.TELEPHONY_PROVIDER],
      ['STT_PROVIDER', env.STT_PROVIDER],
      ['TTS_PROVIDER', env.TTS_PROVIDER],
    ] as const) {
      if (v === 'mock') errs.push(`${k}=mock üretimde olamaz (cascade modu gerçek sağlayıcı ister).`);
    }
  }
  if (env.LLM_PROVIDER === 'mock')
    errs.push('LLM_PROVIDER=mock üretimde olamaz (openai vb. seç).');

  // Türkçe TTS doğallığı ürünün farklılaştırıcısı: İngilizce default sesi reddet.
  if (env.TTS_PROVIDER === 'elevenlabs' && env.ELEVENLABS_VOICE_ID === '21m00Tcm4TlvDq8ikWAM')
    errs.push('ELEVENLABS_VOICE_ID hâlâ Rachel (İngilizce); Türkçe-native bir ses seç.');

  // Auth: control WS ve finalize endpoint'i kimliksiz kalmamalı.
  if (!controlAuthSecret())
    errs.push('CONTROL_AUTH_SECRET (veya INTERNAL_API_SECRET) boş; /control WS kimliksiz.');
  if (!env.INTERNAL_API_SECRET)
    errs.push('INTERNAL_API_SECRET boş; finalize endpoint\'i kimliksiz.');
  if (env.ORCHESTRATION_PROVIDER === 'vapi' && !env.VAPI_SECRET)
    errs.push('VAPI_SECRET boş; Vapi Custom-LLM POST\'ları doğrulanamaz.');

  if (errs.length) {
    throw new Error(
      `Üretim güvenlik kontrolü başarısız (NODE_ENV=production):\n  - ${errs.join('\n  - ')}`,
    );
  }
}
