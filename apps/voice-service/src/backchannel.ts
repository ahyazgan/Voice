// =============================================================================
// backchannel.ts — kısa onay ("hı hı", "tamam", "evet") tespiti
// =============================================================================
// İnsan dinlerken "hı hı", "tabii", "anladım" gibi backchannel verir; bunlar
// KONUŞMA TURU DEĞİLDİR — karşı taraf susmaz, dinlemeye devam eder. AI bunları
// tam tur sayarsa gereksiz yanıt üretip akışı bozar. Burada AI KONUŞURKEN gelen
// kısa onayları backchannel sayıp yok sayarız.
//
// ÖNEMLİ: yalnızca AI konuşurken (TTS çalıyorken) ve metin KISA + onay kalıbıysa.
// Müşteri sırası gelince "evet" tek başına anlamlı olabilir (kimlik onayı) →
// bu yüzden backchannel filtresi sadece "AI konuşurken araya giren" duruma özel.
// Saf fonksiyon → test edilebilir.
// =============================================================================

const BACKCHANNEL_WORDS = new Set([
  'hı', 'hı hı', 'hıhı', 'hmm', 'hm', 'ıhı', 'aha', 'haa',
  'tamam', 'tabii', 'tabi', 'evet', 'peki', 'anladım', 'anlıyorum',
  'olur', 'iyi', 'hı hı hı', 'eee', 'ee', 'ya', 'he', 'hee',
]);

/** Metni normalize eder (küçük harf, noktalama at, fazla boşluk sadeleştir). */
function normalize(text: string): string {
  return text
    .toLocaleLowerCase('tr-TR')
    .replace(/[.,!?…]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Metin bir backchannel (kısa onay) mı? AI konuşurken araya giren bu tür sesler
 * tur sayılmamalı. Kısa (≤2 kelime) VE onay kalıbı olmalı.
 */
export function isBackchannel(text: string): boolean {
  const n = normalize(text);
  if (!n) return true; // boş = gürültü, tur değil
  const words = n.split(' ');
  if (words.length > 2) return false; // 2 kelimeden uzun → gerçek konuşma
  return BACKCHANNEL_WORDS.has(n) || words.every((w) => BACKCHANNEL_WORDS.has(w));
}
