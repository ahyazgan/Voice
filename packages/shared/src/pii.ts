// =============================================================================
// pii.ts — KVKK log maskeleme yardımcıları
// =============================================================================
// Log'lara ham PII (telefon, isim) yazmak KVKK veri minimizasyonuna aykırı.
// Merkezi log servisine giden yapılandırılmış log'lar denetlenmeyebilir.
// Bu yardımcılar tüm servislerce kullanılır; tek doğru maskeleme noktası.
// =============================================================================

/**
 * E.164 telefon numarasını maskeler: son 4 hane görünür, gerisi yıldız.
 * "+905551112233" → "+90******2233". Boş/kısa girdilerde güvenli davranır.
 */
export function maskPhone(phoneE164: string): string {
  if (!phoneE164) return '';
  const last4 = phoneE164.slice(-4);
  const prefix = phoneE164.startsWith('+') ? '+' : '';
  const hidden = Math.max(0, phoneE164.length - 4 - prefix.length);
  return `${prefix}${'*'.repeat(hidden)}${last4}`;
}

/**
 * Tam adı maskeler: ilk ad + soyad baş harfi. "Ayşe Demir" → "Ayşe D.".
 * Log'da kimin arandığını ayırt etmeye yeter, tam ifşa etmez.
 */
export function maskName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 0 || !parts[0]) return '';
  if (parts.length === 1) return parts[0];
  const last = parts[parts.length - 1]!;
  return `${parts[0]} ${last[0]}.`;
}

// =============================================================================
// pino REDACT — savunma hattı (defense-in-depth)
// =============================================================================
// maskPhone/maskName "doğru" yoldur ama bir geliştirici yanlışlıkla ham nesneyi
// (debtor, STT event, callContext) log'larsa PII sızar. pino `redact` bu kazayı
// son anda yakalar: aşağıdaki anahtarlar her log'da otomatik [PII] ile değişir.
// Tüm yollar YAPRAK alandır (ata/torun çakışması yok → pino init'te patlamaz).
// =============================================================================
export const PII_REDACT_PATHS: readonly string[] = [
  // Doğrudan loglanan alanlar.
  'phoneE164',
  'fullName',
  'invoiceRef',
  'text', // STT/transcript turu metni
  'userText', // müşteri turu ham metni
  // Bir seviye iç içe (örn. { debtor: {...} }, { evt: { text } }).
  '*.phoneE164',
  '*.fullName',
  '*.invoiceRef',
  '*.text',
  '*.userText',
  // İki seviye iç içe (örn. { callContext: { debtor: { phoneE164 } } }).
  '*.*.phoneE164',
  '*.*.fullName',
  '*.*.invoiceRef',
];

/** pino `redact` opsiyonu — api ve voice-service logger'ları aynı config'i kullanır. */
export const PII_REDACT = {
  paths: [...PII_REDACT_PATHS],
  censor: '[PII]',
};
