// =============================================================================
// providers/platform/retellWebhook.ts — Retell event webhook (imza + parse)
// =============================================================================
// Retell Custom-LLM WS'ten AYRI bir kanal: call_started / call_ended /
// call_analyzed olayları POST ile gelir. İmza: X-Retell-Signature = "v={tsMs},d={hex}"
// ve digest = HMAC-SHA256(rawBody + tsMs, apiKey). RAW gövde kritik (yeniden
// serileştirilmiş JSON imzayı bozar). 5 dk replay penceresi.
// Ref: https://docs.retellai.com/features/secure-webhook
//
// call_ended payload'ından recording_url + cost + duration geri-çekilir → Faz 1'de
// de finalize'a taşınır (telemetri STT/TTS'i görmez; gerçek maliyet buradan gelir).
// =============================================================================

import { createHmac, timingSafeEqual } from 'node:crypto';

/** İmza 5 dk'dan eski/yeni ise reddet (replay koruması). */
const MAX_SKEW_MS = 5 * 60 * 1000;

/**
 * Retell webhook imzasını doğrular (SAF). `rawBody` HAM istek gövdesi string'i
 * olmalı. `now` test için enjekte edilebilir. Geçerliyse true.
 */
export function verifyRetellSignature(
  rawBody: string,
  signatureHeader: string | undefined,
  apiKey: string,
  now: number = Date.now(),
): boolean {
  if (!signatureHeader || !apiKey) return false;
  // Biçim: "v=1718446800000,d=<hex>"
  const parts = Object.fromEntries(
    signatureHeader.split(',').map((kv) => {
      const i = kv.indexOf('=');
      return [kv.slice(0, i).trim(), kv.slice(i + 1).trim()];
    }),
  );
  const ts = parts.v;
  const digest = parts.d;
  if (!ts || !digest) return false;

  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum) || Math.abs(now - tsNum) > MAX_SKEW_MS) return false;

  const expected = createHmac('sha256', apiKey).update(rawBody + ts).digest('hex');
  const a = Buffer.from(digest);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// --- Webhook payload (kullandığımız alt küme) -------------------------------
export interface RetellWebhookCall {
  call_id?: string;
  metadata?: { callId?: string; debtorId?: string };
  recording_url?: string;
  duration_ms?: number;
  call_cost?: { combined_cost?: number }; // cent
}

export interface RetellWebhookBody {
  event: 'call_started' | 'call_ended' | 'call_analyzed' | string;
  call?: RetellWebhookCall;
}

export interface RetellCallEndedData {
  /** Bizim CallContext.callId (metadata'dan). Eşleme için. */
  callId: string | undefined;
  recordingUrl: string | undefined;
  durationSec: number | undefined;
  /** Toplam maliyet (TRY). combined_cost cent → /100. Retell cent = USD-cent;
   *  TRY'ye çevrim kuru çağırana bırakılır (burada ham cent/100 = "para birimi" değeri). */
  costMinor: number | undefined;
}

/**
 * call_ended payload'ından finalize için gerekli alanları çıkarır (SAF).
 * event call_ended değilse null. callId metadata'dan; yoksa call_id'ye düşmez
 * (call_id Retell'in kimliği, bizimki metadata.callId).
 */
export function extractCallEnded(body: RetellWebhookBody): RetellCallEndedData | null {
  if (body.event !== 'call_ended' || !body.call) return null;
  const c = body.call;
  return {
    callId: c.metadata?.callId,
    recordingUrl: c.recording_url,
    durationSec: c.duration_ms !== undefined ? Math.round(c.duration_ms / 1000) : undefined,
    costMinor: c.call_cost?.combined_cost,
  };
}
