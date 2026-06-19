// =============================================================================
// scheduling/callWindow.ts — ARAMA SAATİ PENCERESİ (saf, timezone-aware)
// =============================================================================
// TR'de ticari arama saatleri sınırlıdır (yaklaşık 08:00–19:00, Pazar/tatil
// yasak — HUKUKÇUYA DOĞRULAT). Pencere dışı arama DÜŞÜRÜLMEZ, bir sonraki açık
// pencereye ZAMANLANIR.
//
// Tasarım: I/O yok, harici lib yok. Borçlunun timezone'undaki yerel saati
// `Intl.DateTimeFormat` ile çözeriz (Node ICU ile gelir). Tüm fonksiyonlar saf →
// birim testiyle tam kapsanır.
// =============================================================================

export interface CallWindowConfig {
  /** "HH:MM" — pencere başlangıcı (borçlu yerel saati). */
  start: string;
  /** "HH:MM" — pencere bitişi (dahil değil; end'e ulaşınca kapalı). */
  end: string;
  /** İzinli ISO günleri: 1=Pzt … 7=Paz. */
  days: number[];
  /** Tatil günleri: "YYYY-MM-DD" (borçlu yerel tarihinde). */
  holidays: string[];
}

/** "HH:MM" → dakika cinsinden gün-içi offset. */
function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/**
 * Bir UTC anını verilen timezone'da parçalara ayırır:
 *   isoDate "YYYY-MM-DD", minutes (gün-içi dakika), isoWeekday (1=Pzt..7=Paz).
 * Intl ile; ekstra bağımlılık yok.
 */
export function zonedParts(
  now: Date,
  timeZone: string,
): { isoDate: string; minutes: number; isoWeekday: number } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'short',
  });
  const parts = fmt.formatToParts(now);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '';
  const year = get('year');
  const month = get('month');
  const day = get('day');
  let hour = Number(get('hour'));
  // hour12:false bazı ortamlarda gece yarısını "24" verir — normalize et.
  if (hour === 24) hour = 0;
  const minute = Number(get('minute'));
  const wdMap: Record<string, number> = {
    Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7,
  };
  const isoWeekday = wdMap[get('weekday')] ?? 1;
  return { isoDate: `${year}-${month}-${day}`, minutes: hour * 60 + minute, isoWeekday };
}

/** Verilen an, borçlu yerel saatinde arama penceresi içinde mi? */
export function isWithinWindow(now: Date, timeZone: string, cfg: CallWindowConfig): boolean {
  const { isoDate, minutes, isoWeekday } = zonedParts(now, timeZone);
  if (cfg.holidays.includes(isoDate)) return false;
  if (!cfg.days.includes(isoWeekday)) return false;
  return minutes >= toMinutes(cfg.start) && minutes < toMinutes(cfg.end);
}

/**
 * `now`'dan itibaren bir sonraki açık pencere başlangıcını (UTC Date) döndürür.
 * Zaten pencere içindeyse `now`'u döndürür (gecikme 0).
 *
 * Yaklaşım: dakika-dakika değil, gün-gün ilerle. Her aday gün için, o günün
 * yerel pencere-başlangıcına denk gelen UTC anını bul; ilk geçerli (gün izinli +
 * tatil değil + başlangıç >= now) olanı döndür. En çok ~14 gün ileri bakar.
 */
export function nextWindowStart(now: Date, timeZone: string, cfg: CallWindowConfig): Date {
  if (isWithinWindow(now, timeZone, cfg)) return now;

  const startMin = toMinutes(cfg.start);
  // 0..14 gün ileri tara (dini bayram + hafta sonu zinciri için bol pay).
  for (let dayOffset = 0; dayOffset <= 14; dayOffset++) {
    const candidate = atZonedTime(now, timeZone, dayOffset, startMin);
    if (candidate.getTime() <= now.getTime()) continue; // geçmiş başlangıç
    const parts = zonedParts(candidate, timeZone);
    if (cfg.holidays.includes(parts.isoDate)) continue;
    if (!cfg.days.includes(parts.isoWeekday)) continue;
    return candidate;
  }
  // Güvenlik: 14 günde açık pencere bulunamadı (aşırı kısıtlı config) → +1 gün sonra.
  return new Date(now.getTime() + 24 * 60 * 60 * 1000);
}

/**
 * `now`'un timezone'undaki tarihine `dayOffset` gün ekleyip, o günün yerel
 * `minutesOfDay` anına denk gelen UTC Date'i üretir. DST kaymalarında ±1 saat
 * sapabilir; pencere genişliği (saatlerce) buna toleranslı, ayrıca worker'da
 * ikinci kapı tekrar doğrular.
 */
function atZonedTime(now: Date, timeZone: string, dayOffset: number, minutesOfDay: number): Date {
  const { isoDate } = zonedParts(now, timeZone);
  const [y, m, d] = isoDate.split('-').map(Number);
  // Hedef yerel tarih (gün eklenmiş).
  const base = new Date(Date.UTC(y!, m! - 1, d! + dayOffset, 0, 0, 0));
  const hh = Math.floor(minutesOfDay / 60);
  const mm = minutesOfDay % 60;
  // base'in o timezone'daki UTC offset'ini bul, hedef yerel saati UTC'ye çevir.
  const offsetMin = zoneOffsetMinutes(base, timeZone);
  return new Date(Date.UTC(y!, m! - 1, d! + dayOffset, hh, mm, 0) - offsetMin * 60_000);
}

/** Verilen an için timezone'un UTC offset'i (dakika; doğu pozitif). */
function zoneOffsetMinutes(at: Date, timeZone: string): number {
  // Aynı anı hem UTC hem hedef tz'de "duvar saati" olarak biçimle, farkı al.
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  const parts = dtf.formatToParts(at);
  const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value ?? '0');
  let hour = get('hour');
  if (hour === 24) hour = 0;
  const asUTC = Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'));
  return Math.round((asUTC - at.getTime()) / 60_000);
}

/** Env değerlerinden CallWindowConfig kurar (config.ts'ten çağrılır). */
export function parseWindowConfig(env: {
  CALL_WINDOW_START: string;
  CALL_WINDOW_END: string;
  CALL_WINDOW_DAYS: string;
  PUBLIC_HOLIDAYS: string;
}): CallWindowConfig {
  return {
    start: env.CALL_WINDOW_START,
    end: env.CALL_WINDOW_END,
    days: env.CALL_WINDOW_DAYS.split(',').map((s) => Number(s.trim())).filter((n) => n >= 1 && n <= 7),
    holidays: env.PUBLIC_HOLIDAYS.split(',').map((s) => s.trim()).filter(Boolean),
  };
}
