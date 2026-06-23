// Arama sonuçlarını CSV'ye dönüştüren saf (DB'siz) mantık — birim test edilir.
// Para alanları KURUŞ (int) gelir, TL (nokta ondalık) yazılır. Tarihler UTC.

export type CsvCallStatus =
  | 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'SCHEDULED' | 'CANCELLED' | 'SKIPPED';

export type CsvOutcome =
  | 'PROMISE_TO_PAY' | 'DISPUTE' | 'WRONG_NUMBER' | 'NO_ANSWER'
  | 'CALLBACK_REQUESTED' | 'ESCALATED_TO_HUMAN' | 'REFUSED';

export interface CsvCallRow {
  fullName: string;
  phoneE164: string;
  amountDueKurus: number;
  status: CsvCallStatus;
  outcome: CsvOutcome | null;
  promisedAmountKurus: number | null;
  promisedDate: string | null; // ISO
  durationSec: number | null;
  costKurus: number | null;
  createdAt: string; // ISO
}

const STATUS_TR: Record<CsvCallStatus, string> = {
  QUEUED: 'Kuyrukta', RUNNING: 'Aranıyor', COMPLETED: 'Tamamlandı', FAILED: 'Başarısız',
  SCHEDULED: 'Planlandı', CANCELLED: 'İptal', SKIPPED: 'Atlandı',
};

const OUTCOME_TR: Record<CsvOutcome, string> = {
  PROMISE_TO_PAY: 'Ödeme sözü', DISPUTE: 'İtiraz', WRONG_NUMBER: 'Yanlış numara',
  NO_ANSWER: 'Cevap yok', CALLBACK_REQUESTED: 'Geri arama',
  ESCALATED_TO_HUMAN: 'İnsana aktarıldı', REFUSED: 'Reddetti',
};

const HEADERS = [
  'Borçlu', 'Telefon', 'Borç (TL)', 'Durum', 'Sonuç',
  'Sözlenen Tutar (TL)', 'Sözlenen Tarih', 'Süre (sn)', 'Maliyet (TL)', 'Oluşturma',
];

/** Kuruş (int) → "1234.56" (nokta ondalık, CSV-güvenli). null → "". */
function kurusToTL(k: number | null): string {
  if (k == null) return '';
  return (k / 100).toFixed(2);
}

/** ISO → "YYYY-MM-DD" (UTC). */
function isoDate(iso: string | null): string {
  return iso ? iso.slice(0, 10) : '';
}

/** ISO → "YYYY-MM-DD HH:mm" (UTC). */
function isoDateTime(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

/** Virgül/tırnak/yeni satır içeren alanı tırnakla, iç tırnağı ikile. */
function esc(field: string): string {
  if (/[",\n\r]/.test(field)) return `"${field.replace(/"/g, '""')}"`;
  return field;
}

export function buildCallsCsv(rows: CsvCallRow[]): string {
  const lines = [HEADERS.join(',')];
  for (const r of rows) {
    lines.push([
      r.fullName,
      r.phoneE164,
      kurusToTL(r.amountDueKurus),
      STATUS_TR[r.status],
      r.outcome ? OUTCOME_TR[r.outcome] : '',
      kurusToTL(r.promisedAmountKurus),
      isoDate(r.promisedDate),
      r.durationSec != null ? String(r.durationSec) : '',
      kurusToTL(r.costKurus),
      isoDateTime(r.createdAt),
    ].map((c) => esc(c)).join(','));
  }
  return lines.join('\r\n');
}
