// Web'e özel API yanıt tipleri. Domain tiplerini @voice/shared'tan al.
import type { CallOutcome } from '@voice/shared';

export type { CallOutcome };

export type CallStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'SCHEDULED'
  | 'CANCELLED'
  | 'SKIPPED';

export type CampaignStatus = 'ACTIVE' | 'PAUSED' | 'CANCELLED' | 'COMPLETED';

export interface Debtor {
  id: string;
  fullName: string;
  phoneE164: string;
  amountDue: number; // kuruş
  currency: string;
  dueDate: string;
  invoiceRef?: string | null;
  timezone: string;
  doNotCall: boolean;
  createdAt: string;
}

export interface CallResult {
  outcome: CallOutcome;
  promisedAmount: number | null; // kuruş
  promisedDate: string | null;
  disputeReason: string | null;
  recordingUrl: string | null;
  costTRY: number; // kuruş
  llmTokensIn: number;
  llmTokensOut: number;
  ttsChars: number;
  sttSec: number;
  telephonySec: number;
  avgResponseMs: number | null;
  p95ResponseMs: number | null;
  bargeIns: number;
}

export interface TranscriptTurn {
  id: string;
  speaker: 'agent' | 'customer' | 'system';
  text: string;
  at: string;
  latencyMs: number | null;
}

export interface CallListItem {
  id: string;
  status: CallStatus;
  outcome: CallOutcome | null;
  scheduledFor: string | null;
  startedAt: string | null;
  durationSec: number | null;
  createdAt: string;
  debtor: Pick<Debtor, 'id' | 'fullName' | 'phoneE164' | 'amountDue'>;
  result: Pick<CallResult, 'outcome' | 'promisedAmount' | 'promisedDate'> | null;
}

export interface CallDetail extends Omit<CallListItem, 'debtor' | 'result'> {
  campaignId: string;
  debtor: Debtor;
  result: CallResult | null;
  transcript: TranscriptTurn[];
}

export interface Campaign {
  id: string;
  name: string;
  status: CampaignStatus;
  createdAt: string;
  _count?: { calls: number };
}

export interface Stats {
  totals: { calls: number; completed: number; failed: number; reached: number };
  rates: { reachRate: number | null; promiseRate: number | null };
  outcomes: Record<CallOutcome, number>;
  promise: { count: number; totalAmount: number }; // totalAmount: kuruş
  cost: {
    totalTRY: number; // kuruş
    perCallTRY: number | null; // kuruş
    perPromiseTRY: number | null; // kuruş
  };
  quality: {
    avgDurationSec: number | null;
    avgResponseMs: number | null;
    p95ResponseMs: number | null;
  };
}
