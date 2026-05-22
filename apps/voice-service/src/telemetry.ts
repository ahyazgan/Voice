// =============================================================================
// telemetry.ts — ARAMA GECİKME ÖLÇÜMÜ + KPI + MALİYET
// =============================================================================
// Faz 2'nin TÜM AMACI gecikme kontrolü. Bu sınıf, her turda STT/LLM/TTS'in
// ne kadar sürdüğünü ölçer ki "neden yavaş?" sorusunu TAHMİNLE değil VERİYLE
// cevaplayalım. Hedef: stt_final → tts_first_chunk ~550ms (tavan 800).
//
// Ayrıca dakika maliyetini derler (CostBreakdown) — sonuç bazlı fiyatlamanın
// kârlı olup olmadığını ancak gerçek maliyeti ölçersek biliriz.
//
// Kullanım:
//   const t = new CallTelemetry(callId, rates);
//   t.mark('stt_final');         // STT turu kapadı (KPI başlangıcı)
//   t.mark('llm_first_token');   // LLM yanıt vermeye başladı
//   t.markOnce('tts_first_chunk'); // TTS ilk paket çıktı (KPI bitişi)
//   t.endTurn();                 // tur metriklerini türet + KPI kontrolü
//   ... tekrar ...
//   const summary = t.finalize(); // CallResult.costBreakdown + avg/p95
// =============================================================================

import { performance } from 'node:perf_hooks';
import pino from 'pino';
import type { CostBreakdown } from '@voice/shared';
import { env } from './config.js';

export const logger = pino({ level: env.LOG_LEVEL });

/** Hedef uçtan uca gecikme (stt_final → tts_first_chunk). */
export const LATENCY_TARGET_MS = 550;
/** Üst sınır — bu eşiğin üstü "KPI ihlali" olarak warn-log'lanır. */
export const LATENCY_CEILING_MS = 800;

export type MarkEvent =
  | 'call_start'
  | 'caller_speaking'
  | 'stt_final'
  | 'llm_first_token'
  | 'tts_first_chunk'
  | 'barge_in';

interface TurnTiming {
  turnIndex: number;
  sttFinalAt?: number | undefined;
  llmFirstTokenAt?: number | undefined;
  ttsFirstChunkAt?: number | undefined;
  bargeIn: boolean;
  llmLatency?: number | undefined;
  ttsLatency?: number | undefined;
  responseLatency?: number | undefined;
}

/** Sağlayıcı fiyatları (config'ten gelir). Verilmezse maliyet 0 döner. */
export interface CostRates {
  telephonyPerMinTRY: number;
  sttPerMinTRY: number;
  ttsPerCharTRY: number;
  llmInPer1kTokTRY: number;
  llmOutPer1kTokTRY: number;
}

export interface CallFinalSummary {
  durationSec: number;
  costBreakdown: CostBreakdown;
  avgResponseMs: number | null;
  p95ResponseMs: number | null;
  turns: number;
  bargeIns: number;
}

export class CallTelemetry {
  private startAt = performance.now();
  private turns: TurnTiming[] = [];
  private current: TurnTiming | null = null;

  private sttSeconds = 0;
  private ttsChars = 0;
  private llmTokensIn = 0;
  private llmTokensOut = 0;

  constructor(
    private readonly callId: string,
    private readonly rates?: CostRates,
  ) {
    this.mark('call_start');
  }

  /** Yeni bir konuşma turu başlat (caller konuşmaya başladığında). */
  startTurn(): void {
    this.current = { turnIndex: this.turns.length, bargeIn: false };
    this.turns.push(this.current);
  }

  /** Olay işaretle. Bilinmeyen olaylar sessizce yok sayılır. */
  mark(event: MarkEvent): void {
    const t = performance.now();
    if (event === 'call_start') return;
    if (event === 'caller_speaking') {
      this.startTurn();
      return;
    }
    if (event === 'barge_in') {
      if (this.current) this.current.bargeIn = true;
      return;
    }

    if (!this.current) this.startTurn();
    const c = this.current!;
    if (event === 'stt_final') c.sttFinalAt = t;
    else if (event === 'llm_first_token') c.llmFirstTokenAt = t;
    else if (event === 'tts_first_chunk') c.ttsFirstChunkAt = t;
  }

  /** tts_first_chunk gibi tur içinde TEK kez yakalanması gereken olaylar için. */
  markOnce(event: MarkEvent): void {
    if (event === 'tts_first_chunk' && this.current?.ttsFirstChunkAt) return;
    if (event === 'llm_first_token' && this.current?.llmFirstTokenAt) return;
    this.mark(event);
  }

  /** Tur bittiğinde gecikmeleri türet + KPI ihlali varsa log'la. */
  endTurn(): void {
    const c = this.current;
    if (!c) return;
    if (c.sttFinalAt !== undefined && c.llmFirstTokenAt !== undefined) {
      c.llmLatency = c.llmFirstTokenAt - c.sttFinalAt;
    }
    if (c.llmFirstTokenAt !== undefined && c.ttsFirstChunkAt !== undefined) {
      c.ttsLatency = c.ttsFirstChunkAt - c.llmFirstTokenAt;
    }
    if (c.sttFinalAt !== undefined && c.ttsFirstChunkAt !== undefined) {
      c.responseLatency = c.ttsFirstChunkAt - c.sttFinalAt;
    }

    if (c.responseLatency !== undefined && c.responseLatency > LATENCY_CEILING_MS) {
      logger.warn(
        {
          callId: this.callId,
          turn: c.turnIndex,
          responseMs: Math.round(c.responseLatency),
          llmMs: c.llmLatency !== undefined ? Math.round(c.llmLatency) : undefined,
          ttsMs: c.ttsLatency !== undefined ? Math.round(c.ttsLatency) : undefined,
          ceilingMs: LATENCY_CEILING_MS,
        },
        'KPI ihlali: yanıt gecikmesi tavan üstü',
      );
    }
    this.current = null;
  }

  // --- maliyet sayaç güncelleyiciler (provider'lar tur boyunca çağırır) ----
  addSttSeconds(s: number): void {
    this.sttSeconds += s;
  }
  addTtsChars(n: number): void {
    this.ttsChars += n;
  }
  addLlmTokens(inTok: number, outTok: number): void {
    this.llmTokensIn += inTok;
    this.llmTokensOut += outTok;
  }

  /** Arama sonunda: CallResult.costBreakdown + özet metrikler. */
  finalize(): CallFinalSummary {
    const durationSec = (performance.now() - this.startAt) / 1000;
    const valid = this.turns
      .map((t) => t.responseLatency)
      .filter((x): x is number => x !== undefined);
    const avg = valid.length ? valid.reduce((s, v) => s + v, 0) / valid.length : null;
    const p95 = percentile(valid, 95);

    const r = this.rates;
    const totalTRY = r
      ? (durationSec / 60) * r.telephonyPerMinTRY +
        (this.sttSeconds / 60) * r.sttPerMinTRY +
        this.ttsChars * r.ttsPerCharTRY +
        (this.llmTokensIn / 1000) * r.llmInPer1kTokTRY +
        (this.llmTokensOut / 1000) * r.llmOutPer1kTokTRY
      : 0;

    const costBreakdown: CostBreakdown = {
      telephonySec: Math.round(durationSec),
      sttSec: Math.round(this.sttSeconds),
      llmTokensIn: this.llmTokensIn,
      llmTokensOut: this.llmTokensOut,
      ttsChars: this.ttsChars,
      totalTRY: Number(totalTRY.toFixed(2)),
    };

    const summary: CallFinalSummary = {
      durationSec,
      costBreakdown,
      avgResponseMs: avg !== null ? Math.round(avg) : null,
      p95ResponseMs: p95 !== null ? Math.round(p95) : null,
      turns: this.turns.length,
      bargeIns: this.turns.filter((t) => t.bargeIn).length,
    };

    logger.info(
      {
        callId: this.callId,
        durationSec: Math.round(durationSec),
        turns: summary.turns,
        avgResponseMs: summary.avgResponseMs,
        p95ResponseMs: summary.p95ResponseMs,
        bargeIns: summary.bargeIns,
        costTRY: costBreakdown.totalTRY,
      },
      'arama tamamlandı',
    );

    return summary;
  }
}

function percentile(xs: number[], p: number): number | null {
  if (!xs.length) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)] ?? null;
}
