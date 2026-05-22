import type { CallOutcome, TranscriptTurn } from '@voice/shared';
import { env } from './config.js';
import { logger, type CallFinalSummary } from './telemetry.js';

export interface FinalizePayload {
  callId: string;
  outcome: CallOutcome;
  promisedAmount?: number;
  promisedDate?: string;
  disputeReason?: string;
  recordingUrl?: string;
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
  const body = {
    outcome: p.outcome,
    promisedAmount: p.promisedAmount,
    promisedDate: p.promisedDate,
    disputeReason: p.disputeReason,
    recordingUrl: p.recordingUrl,
    durationSec: p.summary.durationSec,
    avgResponseMs: p.summary.avgResponseMs ?? undefined,
    p95ResponseMs: p.summary.p95ResponseMs ?? undefined,
    bargeIns: p.summary.bargeIns,
    cost: p.summary.costBreakdown,
    transcript: p.transcript,
  };

  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 5_000);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      logger.warn({ callId: p.callId, status: res.status }, 'finalize POST başarısız');
    }
  } catch (err) {
    logger.warn({ callId: p.callId, err }, 'finalize POST hatası');
  }
}
