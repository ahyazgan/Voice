// Borçlu CSV parse + validasyon (client-side). Format:
//   fullName,phoneE164,amountDue,dueDate,invoiceRef
// amountDue TL girilir ("1.234,56" veya "1234.56") → kuruş'a çevrilir.
// dueDate YYYY-MM-DD → ISO datetime.

export interface DebtorInput {
  fullName: string;
  phoneE164: string;
  amountDue: number; // kuruş
  dueDate: string; // ISO
  invoiceRef?: string;
}

export interface ParseResult {
  valid: DebtorInput[];
  errors: { row: number; message: string }[];
}

/** TL string → kuruş integer. "1.234,56" / "1234.56" / "1234" desteklenir. */
function parseAmountToKurus(raw: string): number | null {
  let s = raw.trim();
  if (!s) return null;
  // Türk biçimi "1.234,56": nokta binlik, virgül ondalık.
  if (s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.');
  }
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

function splitLine(line: string): string[] {
  // Basit tırnak desteği: "a,b" tek alan kalır.
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (const ch of line) {
    if (ch === '"') inQ = !inQ;
    else if (ch === ',' && !inQ) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

const PHONE_RE = /^\+\d{8,15}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseDebtorsCsv(text: string): ParseResult {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return { valid: [], errors: [{ row: 0, message: 'Dosya boş.' }] };

  // İlk satır başlık mı? "fullName" içeriyorsa atla.
  let start = 0;
  if (/fullname|isim|ad/i.test(lines[0]!) && /phone|telefon/i.test(lines[0]!)) start = 1;

  const valid: DebtorInput[] = [];
  const errors: ParseResult['errors'] = [];

  for (let i = start; i < lines.length; i++) {
    const rowNum = i + 1;
    const cols = splitLine(lines[i]!);
    const [fullName, phoneE164, amountRaw, dueDate, invoiceRef] = cols;

    if (!fullName) { errors.push({ row: rowNum, message: 'İsim boş.' }); continue; }
    if (!phoneE164 || !PHONE_RE.test(phoneE164)) {
      errors.push({ row: rowNum, message: `Geçersiz telefon: "${phoneE164 ?? ''}" (+90… bekleniyor).` });
      continue;
    }
    const amountDue = parseAmountToKurus(amountRaw ?? '');
    if (amountDue == null) {
      errors.push({ row: rowNum, message: `Geçersiz tutar: "${amountRaw ?? ''}".` });
      continue;
    }
    if (!dueDate || !DATE_RE.test(dueDate)) {
      errors.push({ row: rowNum, message: `Geçersiz vade tarihi: "${dueDate ?? ''}" (YYYY-MM-DD).` });
      continue;
    }

    valid.push({
      fullName,
      phoneE164,
      amountDue,
      dueDate: new Date(`${dueDate}T00:00:00Z`).toISOString(),
      ...(invoiceRef ? { invoiceRef } : {}),
    });
  }

  return { valid, errors };
}
