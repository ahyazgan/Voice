import type { CallOutcome, TranscriptTurn } from '@voice/shared';
import { env } from './config.js';
import { logger, type CallFinalSummary } from './telemetry.js';

export interface FinalizePayload {
  callId: string;
  outcome: CallOutcome;
  promisedAmount?: number;
  promisedDate?: string;
  disputeReason?: string;
  paymentMethod?: 'BANK_TRANSFER' | 'CASH' | 'CARD' | 'INSTALLMENT';
  recordingUrl?: string;
  /** KVKK: rıza yoksa recordingUrl asla gönderilmez (default false = güvenli). */
  consentToRecord?: boolean;
  summary: CallFinalSummary;
  transcript: readonly TranscriptTurn[];
  /**
   * Faz 1: platformun raporladığı toplam maliyet (TRY). Faz 1'de STT/TTS maliyeti
   * telemetri'de görünmez (ses platformda akar) → totalTRY eksik kalır. Platform
   * bu değeri verirse API costTRY'ı bununla doldurur. Faz 2'de undefined (telemetri tam).
   */
  platformCostTRY?: number;
}

/**
 * Telemetri özetini + transkripti API'ye POST eder.
 * Best-effort: API erişilemezse log'lar ve sessizce başarısız olur.
 * Çağrıyı bloklayacak bir bağımlılık değil — sadece raporlama.
 */
export async function postFinalize(p: FinalizePayload): Promise<void> {
  if (!env.API_BASE_URL) {
    logger.debug({ callId: p.callId }, 'API_BASE_URL yok; finalize POST atlandı');
    return;
  }

  const url = `${env.API_BASE_URL.replace(/\/$/, '')}/api/calls/${encodeURIComponent(p.callId)}/finalize`;

  // KVKK veri minimizasyonu: açık rıza yoksa kayıt URL'sini ASLA gönderme.
  // Rıza bilgisi gelmezse (undefined) güvenli tarafta kal → URL'yi düşür.
  const recordingUrl = p.consentToRecord ? p.recordingUrl : undefined;
  if (p.recordingUrl && !p.consentToRecord) {
    logger.info({ callId: p.callId }, 'KVKK: rıza yok, recordingUrl finalize\'dan çıkarıldı');
  }

  const body = {
    outcome: p.outcome,
    promisedAmount: p.promisedAmount,
    promisedDate: p.promisedDate,
    disputeReason: p.disputeReason,
    paymentMethod: p.paymentMethod,
    recordingUrl,
    recordingConsent: p.consentToRecord === true,
    durationSec: p.summary.durationSec,
    avgResponseMs: p.summary.avgResponseMs ?? undefined,
    p95ResponseMs: p.summary.p95ResponseMs ?? undefined,
    bargeIns: p.summary.bargeIns,
    cost: p.summary.costBreakdown,
    ...(p.platformCostTRY !== undefined && { platformCostTRY: p.platformCostTRY }),
    transcript: p.transcript,
  };

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 5_000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(env.INTERNAL_API_SECRET && { 'x-internal-secret': env.INTERNAL_API_SECRET }),
      },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    if (!res.ok) {
      logger.warn({ callId: p.callId, status: res.status }, 'finalize POST başarısız');
    }
  } catch (err) {
    // Hata yolunda da timer'ı temizle — aksi halde her başarısız POST bir timer sızdırır.
    logger.warn({ callId: p.callId, err }, 'finalize POST hatası');
  } finally {
    clearTimeout(timer);
  }
}

export interface RecordingCostPayload {
  callId: string;
  recordingUrl?: string;
  durationSec?: number;
  /** Platform toplam maliyeti, minör birim (Retell combined_cost = cent). */
  platformCostMinor?: number;
}

/**
 * Retell event webhook'undan gelen platform-tarafı metadata'yı (kayıt URL'si,
 * gerçek maliyet, süre) API'ye iletir. Finalize'dan AYRI ve ondan SONRA gelebilir
 * (webhook ≠ WS kapanışı). API tarafı recordingUrl'i KVKK rıza kontrolünden
 * geçirir (rıza yoksa yazmaz). Best-effort.
 */
export async function postRecordingCost(p: RecordingCostPayload): Promise<void> {
  if (!env.API_BASE_URL) return;
  const url = `${env.API_BASE_URL.replace(/\/$/, '')}/api/calls/${encodeURIComponent(p.callId)}/recording-cost`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 5_000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(env.INTERNAL_API_SECRET && { 'x-internal-secret': env.INTERNAL_API_SECRET }),
      },
      body: JSON.stringify({
        ...(p.recordingUrl !== undefined && { recordingUrl: p.recordingUrl }),
        ...(p.durationSec !== undefined && { durationSec: p.durationSec }),
        ...(p.platformCostMinor !== undefined && { platformCostMinor: p.platformCostMinor }),
      }),
      signal: ac.signal,
    });
    if (!res.ok) logger.warn({ callId: p.callId, status: res.status }, 'recording-cost POST başarısız');
  } catch (err) {
    logger.warn({ callId: p.callId, err }, 'recording-cost POST hatası');
  } finally {
    clearTimeout(timer);
  }
}
