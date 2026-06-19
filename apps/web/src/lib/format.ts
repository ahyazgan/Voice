// Para her yerde KURUŞ (integer). TL gösterimi yalnızca BURADAN — manuel /100 yok.

const tryFmt = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' });

/** Kuruş (int) → "1.250,00 ₺". */
export function formatKurus(kurus: number | null | undefined): string {
  if (kurus == null) return '—';
  return tryFmt.format(kurus / 100);
}

const dateFmt = new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium' });
const dateTimeFmt = new Intl.DateTimeFormat('tr-TR', { dateStyle: 'short', timeStyle: 'short' });

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return dateFmt.format(new Date(iso));
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return dateTimeFmt.format(new Date(iso));
}

/** Saat:dakika (transkript balonları için). */
export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
}

export function formatDuration(sec: number | null | undefined): string {
  if (sec == null) return '—';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}dk ${s}sn` : `${s}sn`;
}
