import type { ReactNode } from 'react';
import type { CallStatus, CallOutcome, CampaignStatus } from '../types.js';

export function Spinner() {
  return <div className="state">Yükleniyor…</div>;
}

export function ErrorState({ message }: { message?: string }) {
  return <div className="state error">Hata: {message ?? 'bir şeyler ters gitti'}</div>;
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="state">{children}</div>;
}

const STATUS_TONE: Record<CallStatus, string> = {
  QUEUED: '',
  SCHEDULED: 'info',
  RUNNING: 'info',
  COMPLETED: 'ok',
  FAILED: 'danger',
  CANCELLED: 'warn',
  SKIPPED: 'warn',
};
const STATUS_TR: Record<CallStatus, string> = {
  QUEUED: 'Kuyrukta',
  SCHEDULED: 'Planlandı',
  RUNNING: 'Aranıyor',
  COMPLETED: 'Tamamlandı',
  FAILED: 'Başarısız',
  CANCELLED: 'İptal',
  SKIPPED: 'Atlandı',
};

export function StatusBadge({ status }: { status: CallStatus }) {
  return <span className={`badge ${STATUS_TONE[status]}`}>{STATUS_TR[status]}</span>;
}

const OUTCOME_TONE: Record<CallOutcome, string> = {
  PROMISE_TO_PAY: 'ok',
  DISPUTE: 'warn',
  WRONG_NUMBER: 'danger',
  NO_ANSWER: '',
  CALLBACK_REQUESTED: 'info',
  ESCALATED_TO_HUMAN: 'warn',
  REFUSED: 'danger',
};
const OUTCOME_TR: Record<CallOutcome, string> = {
  PROMISE_TO_PAY: 'Ödeme sözü',
  DISPUTE: 'İtiraz',
  WRONG_NUMBER: 'Yanlış numara',
  NO_ANSWER: 'Cevap yok',
  CALLBACK_REQUESTED: 'Geri arama',
  ESCALATED_TO_HUMAN: 'İnsana aktarıldı',
  REFUSED: 'Reddetti',
};

export function OutcomeBadge({ outcome }: { outcome: CallOutcome | null | undefined }) {
  if (!outcome) return <span className="badge">—</span>;
  return <span className={`badge ${OUTCOME_TONE[outcome]}`}>{OUTCOME_TR[outcome]}</span>;
}

const CAMPAIGN_TONE: Record<CampaignStatus, string> = {
  ACTIVE: 'ok',
  PAUSED: 'warn',
  CANCELLED: 'danger',
  COMPLETED: '',
};
const CAMPAIGN_TR: Record<CampaignStatus, string> = {
  ACTIVE: 'Aktif',
  PAUSED: 'Duraklatıldı',
  CANCELLED: 'İptal',
  COMPLETED: 'Bitti',
};

export function CampaignBadge({ status }: { status: CampaignStatus }) {
  return <span className={`badge ${CAMPAIGN_TONE[status]}`}>{CAMPAIGN_TR[status]}</span>;
}
