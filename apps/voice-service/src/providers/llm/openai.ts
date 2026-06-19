// =============================================================================
// providers/llm/openai.ts — ILLMProvider (OpenAI Chat Completions)
// =============================================================================
// gpt-4o-mini varsayılan: telefon konuşması için hız/kalite dengesi en iyi.
// "En hızlı, en büyük değil" (ARCHITECTURE §1.son).
//
// Strict JSON schema ile { say, intent, fields } şemasını LLM'e DAYATIYORUZ —
// serbest metin değil. OpenAI strict mode TÜM property'lerin required listesinde
// olmasını ister; optional'lar için type union'a "null" ekliyoruz, parse sonrası
// null'ları kırpıp Zod-uyumlu hale getiriyoruz.
// =============================================================================

import OpenAI from 'openai';
import type {
  ILLMProvider,
  LLMIntent,
  LLMRequest,
  LLMStructuredOutput,
  TranscriptTurn,
} from '@voice/shared';
import { env } from '../../config.js';
import { logger } from '../../telemetry.js';
import { intentsForState } from '../../prompts/index.js';

/** Her çağrıda state-spesifik intent enum'u ile schema kurar. */
function buildSchema(allowedIntents: readonly LLMIntent[]) {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      say: { type: 'string', description: 'TTS ile söylenecek kısa Türkçe metin.' },
      intent: { type: 'string', enum: [...allowedIntents] },
      fields: {
        type: ['object', 'null'],
        additionalProperties: false,
        properties: {
          amount: { type: ['integer', 'null'], description: 'Kuruş cinsinden integer.' },
          date: { type: ['string', 'null'], description: 'YYYY-MM-DD veya tam ISO 8601.' },
          reason: { type: ['string', 'null'] },
        },
        required: ['amount', 'date', 'reason'],
      },
    },
    required: ['say', 'intent', 'fields'],
  };
}

export class OpenAILLM implements ILLMProvider {
  readonly name = 'openai';
  private client: OpenAI;
  private model: string;
  private temperature: number;

  constructor(opts: { apiKey: string; model?: string; temperature?: number }) {
    // Telefon turu gerçek-zamanlı: müşteri hatta bekler. SDK default timeout'u
    // (~10dk) burada KABUL EDİLEMEZ. Tek tur için sıkı timeout + 1 retry —
    // platform (Retell) tarafının ~30sn tur timeout'undan rahat içeride kalır.
    this.client = new OpenAI({ apiKey: opts.apiKey, timeout: 8_000, maxRetries: 1 });
    this.model = opts.model ?? env.OPENAI_MODEL;
    this.temperature = opts.temperature ?? env.OPENAI_TEMPERATURE;
  }

  async respond(req: LLMRequest): Promise<LLMStructuredOutput> {
    const messages = buildMessages(req);
    const allowed = intentsForState(req.context.state);
    const schema = buildSchema(allowed);

    const completion = await this.client.chat.completions.create({
      model: this.model,
      temperature: this.temperature,
      // Telefon konuşması için 1-2 cümle yeterli; 500 token rahat tampon bırakır.
      max_tokens: 500,
      messages,
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'collections_turn', strict: true, schema },
      },
    });

    const choice = completion.choices[0];
    if (!choice?.message?.content) {
      logger.warn({ callId: req.context.callContext.callId }, 'openai empty content');
      return { say: 'Sizi tam duyamadım, tekrar eder misiniz?', intent: 'NO_RESPONSE' };
    }

    // Truncate → JSON malformed; bekleme yapma, fallback ver.
    if (choice.finish_reason === 'length') {
      logger.warn(
        { callId: req.context.callContext.callId, state: req.context.state },
        'openai response truncated (max_tokens)',
      );
      return { say: 'Kusura bakmayın, kısa tekrar eder misiniz?', intent: 'NO_RESPONSE' };
    }

    const raw = JSON.parse(choice.message.content) as {
      say: string;
      intent: LLMIntent;
      fields: { amount: number | null; date: string | null; reason: string | null } | null;
    };

    const out: LLMStructuredOutput = { say: raw.say, intent: raw.intent };
    if (raw.fields) {
      const fields: NonNullable<LLMStructuredOutput['fields']> = {};
      if (raw.fields.amount !== null) fields.amount = raw.fields.amount;
      if (raw.fields.date !== null) fields.date = raw.fields.date;
      if (raw.fields.reason !== null) fields.reason = raw.fields.reason;
      if (Object.keys(fields).length > 0) out.fields = fields;
    }
    // Maliyet telemetrisi: token kullanımını taşı. Sonuç-bazlı fiyatlama bu
    // sayıya dayanır; düşersek CostBreakdown.totalTRY eksik hesaplanır.
    if (completion.usage) {
      out.usage = {
        tokensIn: completion.usage.prompt_tokens,
        tokensOut: completion.usage.completion_tokens,
      };
    }
    return out;
  }
}

function buildMessages(req: LLMRequest): OpenAI.Chat.ChatCompletionMessageParam[] {
  const msgs: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: req.systemPrompt },
  ];
  // Tarihçe — son N turla sınırla (telefon konuşmasında bağlam kısa).
  const recent = req.context.history.slice(-20);
  for (const t of recent) msgs.push(toOpenAIMessage(t));
  msgs.push({ role: 'user', content: req.userText });
  return msgs;
}

function toOpenAIMessage(t: TranscriptTurn): OpenAI.Chat.ChatCompletionMessageParam {
  if (t.speaker === 'agent') return { role: 'assistant', content: t.text };
  if (t.speaker === 'customer') return { role: 'user', content: t.text };
  return { role: 'system', content: t.text };
}
