// =============================================================================
// prosody.ts — İçeriğe göre teslimat (prozodi) — saf fonksiyon
// =============================================================================
// İnsan, bir tutarı veya tarihi söylerken karşıdakinin YAZABİLMESİ için kısa bir
// duraklama bırakır ("bin iki yüz elli lira ... vade on beş Nisan"). Robot ise
// hepsini tek nefeste sıralar → bilgi kaçar, robotik. Burada rakam/tarih/yüzde
// gibi "önemli figürlerin" ARDINA doğal bir duraklama (virgül) ekleriz; TTS bunu
// prozodik mola olarak okur. Tüm TTS sağlayıcılarında güvenli (SSML tag'i değil,
// noktalama). normalizeForTTS'ten ÖNCE çalışır (figürler hâlâ rakam biçimindeyken).
//
// İlke (docs/dogallik-ve-insansilik.md §0 #2): "rakam okutma" kendi konuşma
// edimidir — yavaş ve aralıklı. Burası onun çekirdeği.
// =============================================================================

// Para: "1.250,00 TL" / "1250 ₺" / "500 lira" (ttsNormalize ile aynı yakalama).
const MONEY = /\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?\s*(?:TL|₺|lira|Lira)|\d+(?:[.,]\d{1,2})?\s*(?:TL|₺|lira|Lira)/;
// Tarih: ISO "YYYY-MM-DD".
const DATE = /\d{4}-\d{2}-\d{2}/;
// Yüzde: "%25" veya "25%".
const PERCENT = /%\s*\d+|\d+\s*%/;

// "Önemli figür" hemen ardından BOŞLUK + harf/rakam geliyorsa (yani cümle
// bitmiyor, noktalama yoksa) figürün ardına virgül koy → doğal "otursun" molası.
// Türkçe harfleri de word-char say.
const FIGURE = new RegExp(
  `(${MONEY.source}|${DATE.source}|${PERCENT.source})(?=\\s+[\\wçğıöşüÇĞİÖŞÜ])`,
  'gu',
);

/**
 * Önemli figürlerin (para/tarih/yüzde) ardına doğal duraklama (virgül) ekler ki
 * dinleyen yazabilsin. Zaten noktalama geliyorsa dokunmaz. Saf → test edilebilir.
 * Orchestrator akışı: paceForDelivery(text) → normalizeForTTS(...) → TTS.
 */
export function paceForDelivery(text: string): string {
  return text.replace(FIGURE, (m) => `${m},`);
}
