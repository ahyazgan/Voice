// =============================================================================
// ttsNormalize.ts — Türkçe TTS metin normalizasyonu
// =============================================================================
// LLM "1.250,00 TL" veya "2026-04-15" üretebilir; ham TTS bunu "bir nokta iki
// beş..." / "iki bin yirmi altı tire..." gibi okur → robotik. Burada para,
// tarih ve ondalıkları İNSAN okunuşuna çeviririz ("bin iki yüz elli lira",
// "on beş Nisan"). Saf fonksiyon → tam test edilebilir.
// =============================================================================

const ONES = ['', 'bir', 'iki', 'üç', 'dört', 'beş', 'altı', 'yedi', 'sekiz', 'dokuz'];
const TENS = ['', 'on', 'yirmi', 'otuz', 'kırk', 'elli', 'altmış', 'yetmiş', 'seksen', 'doksan'];
const MONTHS = [
  '', 'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
];

/** 0..999 → Türkçe kelime ("yüz", "iki yüz elli"). Yüz için "bir yüz" denmez. */
function under1000(n: number): string {
  const parts: string[] = [];
  const h = Math.floor(n / 100);
  const t = Math.floor((n % 100) / 10);
  const o = n % 10;
  if (h > 0) parts.push(h === 1 ? 'yüz' : `${ONES[h]} yüz`);
  if (t > 0) parts.push(TENS[t]!);
  if (o > 0) parts.push(ONES[o]!);
  return parts.join(' ');
}

/** Tam sayıyı Türkçe kelimeye çevirir. "bin" için "bir bin" denmez. */
export function turkishNumber(n: number): string {
  if (n === 0) return 'sıfır';
  if (n < 0) return `eksi ${turkishNumber(-n)}`;

  const groups: { value: number; scale: string }[] = [
    { value: Math.floor(n / 1_000_000_000) % 1000, scale: 'milyar' },
    { value: Math.floor(n / 1_000_000) % 1000, scale: 'milyon' },
    { value: Math.floor(n / 1000) % 1000, scale: 'bin' },
    { value: n % 1000, scale: '' },
  ];

  const out: string[] = [];
  for (const g of groups) {
    if (g.value === 0) continue;
    if (g.scale === 'bin' && g.value === 1) out.push('bin'); // "bir bin" değil
    else out.push(`${under1000(g.value)}${g.scale ? ' ' + g.scale : ''}`);
  }
  return out.join(' ').replace(/\s+/g, ' ').trim();
}

const DIGIT_WORDS = ['sıfır', 'bir', 'iki', 'üç', 'dört', 'beş', 'altı', 'yedi', 'sekiz', 'dokuz'];

/** Bir rakam dizisini tek tek okunuşa çevirir ("0555" → "sıfır beş beş beş"). */
function readDigits(digits: string): string {
  return digits
    .split('')
    .map((ch) => DIGIT_WORDS[Number(ch)] ?? ch)
    .join(' ');
}

/** "1.250,00" / "1250.50" / "1250" gibi TL string'ini sayıya (lira+kuruş) çevirir. */
function parseTrAmount(raw: string): { lira: number; kurus: number } | null {
  let s = raw.trim();
  if (s.includes(',')) {
    // Türk biçimi: nokta binlik, virgül ondalık.
    s = s.replace(/\./g, '').replace(',', '.');
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return { lira: Math.floor(n), kurus: Math.round((n - Math.floor(n)) * 100) };
}

/**
 * TTS'e gidecek Türkçe metni normalize eder:
 *   - Para: "1.250,00 TL" / "1250 ₺" → "bin iki yüz elli lira"
 *   - Tarih: "2026-04-15" → "on beş Nisan"
 *   - Yüzde: "%25" → "yüzde yirmi beş"
 *   - Saat: "14:30" → "on dört otuz"
 *   - Telefon (TR) / IBAN → rakam rakam okunur (yanlış anlaşılmasın diye).
 */
export function normalizeForTTS(text: string): string {
  let out = text;

  // 0) IBAN "TR" + 24 hane → "TR" + rakam rakam (tek seferde anlaşılır okuma).
  // Tarih/para regex'lerinden ÖNCE: uzun hane dizisi onlara yem olmasın.
  out = out.replace(/\bTR(\d{24})\b/gi, (_m, d) => `TR ${readDigits(d)}`);

  // 0b) Telefon (TR): +90XXXXXXXXXX veya 0XXXXXXXXXX → "sıfır beş beş ...".
  out = out.replace(/\+90(\d{10})\b/g, (_m, d) => readDigits('0' + d));
  out = out.replace(/\b0(\d{10})\b/g, (_m, d) => readDigits('0' + d));

  // 1) ISO tarih "YYYY-MM-DD" → "gün AyAdı" (yıl genelde gereksiz, telefonda kısa).
  out = out.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (_m, _y, mm, dd) => {
    const month = MONTHS[Number(mm)] ?? '';
    const day = Number(dd);
    return month ? `${turkishOrdinalDay(day)} ${month}` : _m;
  });

  // 2) Para: sayı + (TL|₺|lira). Binlik/ondalıklı biçimleri yakala. ₺ word-char
  // olmadığından sonda \b yok; suffix'i (?=\s|$|[.,!?]) ile sınırla.
  out = out.replace(
    /(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s*(TL|₺|lira|Lira)(?=\s|$|[.,!?])/g,
    (_m, num) => {
      const parsed = parseTrAmount(num);
      if (!parsed) return _m;
      const liraWords = turkishNumber(parsed.lira) + ' lira';
      return parsed.kurus > 0 ? `${liraWords} ${turkishNumber(parsed.kurus)} kuruş` : liraWords;
    },
  );

  // 3) Yüzde: "%25" / "25 %" → "yüzde yirmi beş".
  out = out.replace(/%\s*(\d+)/g, (_m, n) => `yüzde ${turkishNumber(Number(n))}`);
  out = out.replace(/(\d+)\s*%/g, (_m, n) => `yüzde ${turkishNumber(Number(n))}`);

  // 4) Saat "HH:MM" → "on dört otuz". Sadece geçerli saat; saniyeli zinciri (14:30:00)
  // ve daha uzun sayının parçasını dışla. Dakika 00 ise yalnızca saati oku.
  out = out.replace(/(?<!\d)([01]?\d|2[0-3]):([0-5]\d)(?![:\d])/g, (_m, hh, mm) => {
    const h = turkishNumber(Number(hh));
    const m = Number(mm);
    return m > 0 ? `${h} ${turkishNumber(m)}` : h;
  });

  return out;
}

/** Gün sayısını okunuşa çevirir (1→"bir", 15→"on beş"). Ay-günü için yeterli. */
function turkishOrdinalDay(d: number): string {
  return turkishNumber(d);
}
