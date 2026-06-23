import type { CallOutcome, TranscriptTurn } from '@voice/shared';
import { env } from './config.js';
import { logger, type CallFinalSummary } from './telemetry.js';

export interface FinalizePayload {
  callId: string;
  outcome: CallOutcome;
  promisedAmount?: number;
  promisedDate?: string;
  callbackAt?: string;
  disputeReason?: string;
  recordingUrl?: string;
  /** KVKK: rıza yoksa recordingUrl asla gönderilmez (default false = güvenli). */
  consentToRecord?: boolean;
  summary: CallFinalSummary;
  transcript: readonly TranscriptTurn[];
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
    callbackAt: p.callbackAt,
    disputeReason: p.disputeReason,
    recordingUrl,
    durationSec: p.summary.durationSec,
    avgResponseMs: p.summary.avgResponseMs ?? undefined,
    p95ResponseMs: p.summary.p95ResponseMs ?? undefined,
    bargeIns: p.summary.bargeIns,
    cost: p.summary.costBreakdown,
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
