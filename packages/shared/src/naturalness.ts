// =============================================================================
// naturalness.ts — İnsansılık yardımcıları (saf fonksiyonlar)
// =============================================================================
// Sesin "robot değil insan" hissettirmesi yüzlerce mikro-davranışın toplamıdır.
// Burada bunların TEST EDİLEBİLİR, transport'tan bağımsız çekirdeğini topluyoruz:
//   - detectEmotionalCue: müşteri zorluk/duygu belirtti mi (empati tetikleyici)
//   - responseDelayMs: cevaptan önce "insan beat'i" (duygusal anda mikro-pause)
//   - voiceToneForState: konuşma edimine göre TTS tonu (empati=sıcak, teyit=net)
//   - pickThinkingFiller: gecikme maskeleme için kısa doğal dolgu ("Tabii...")
//
// İlke (docs/dogallik-ve-insansilik.md §0): doğallık ses kalitesinden değil
// ZAMANLAMA + PROZODİ + KELİME'den gelir. Bu modül o üçünün çekirdeğidir.
// =============================================================================

import type { ConversationState } from './types.js';

// --- 1) Duygusal/zorluk ipucu tespiti ---------------------------------------
// Müşteri "işsizim / param yok / hastayım / vefat" gibi bir zorluk belirtirse
// ÖNCE empati, SONRA çözüm (prompt kuralı). Burada o anı tespit ederiz ki
// orchestrator cevaptan önce kısa bir "seni aldım" duraklaması koyabilsin.
// Stem (kök) eşleşmesi: Türkçe çekim eklerini yakalamak için substring.
const EMOTIONAL_CUE_STEMS: readonly string[] = [
  'işsiz', 'işten çık', 'çıkarıl', 'işten attı', 'işten atıl',
  'param yok', 'paramız yok', 'maaş', 'alamad', 'yatıramad', 'ödeyemiyorum', 'ödeyemem',
  'geçinemi', 'geçim', 'zor durum', 'zor gün', 'çok zor', 'sıkıntı', 'darda',
  'hasta', 'hastane', 'ameliyat', 'tedavi', 'rahatsız',
  'vefat', 'öldü', 'kaybett', 'cenaze',
  'iflas', 'batt', 'haciz', 'icra',
  'mağdur', 'perişan', 'çaresiz', 'kira',
];

/** Metni normalize eder (küçük harf tr, fazla boşluk sadeleştir). */
function normalize(text: string): string {
  return text.toLocaleLowerCase('tr-TR').replace(/\s+/g, ' ').trim();
}

/**
 * Müşteri girdisi bir zorluk/duygu ipucu içeriyor mu? Empati duraklaması ve
 * tonu için tetikleyici. Yanlış pozitif maliyeti düşük (sadece ~0.5sn pause).
 */
export function detectEmotionalCue(text: string): boolean {
  const n = normalize(text);
  if (!n) return false;
  return EMOTIONAL_CUE_STEMS.some((stem) => n.includes(stem));
}

// --- 2) Cevap gecikmesi (insan beat'i) --------------------------------------
// İnsan, ACI/zor bir girdiden sonra cevap vermeden önce bir an durur — bu "seni
// duydum, üzerine düşünüyorum" sinyalidir. Anlık cevap = sosyopat hissi (en güçlü
// "ele veren an"). Nötr girdide GECİKME EKLEMEYİZ: sistem gecikmesi (LLM+TTS)
// zaten doğal beat'i sağlar, KPI tavanını (800ms) korumak şart.

export interface ResponseDelayOpts {
  /** Duygusal ipucunda eklenecek mikro-pause (ms). Nötr girdide 0. */
  empathyPauseMs: number;
}

/**
 * Bu müşteri turundan sonra AI cevabından ÖNCE beklenecek ek süre (ms).
 * Yalnızca duygusal ipucu varsa > 0; aksi halde 0 (hız korunur).
 */
export function responseDelayMs(userText: string, opts: ResponseDelayOpts): number {
  return detectEmotionalCue(userText) ? Math.max(0, opts.empathyPauseMs) : 0;
}

// --- 3) Duruma göre TTS tonu -------------------------------------------------
// Tek TTS ayarı her konuşma edimine uymaz (docs §0 ilke 2). Empati/pazarlıkta
// sıcak ve esnek (düşük stability, yüksek style); teyitte (tutar+tarih geri okuma)
// net ve sabit (yüksek stability, düşük style); öfkede yumuşak.
// Çıktı, config'teki TABAN değere uygulanan delta'dır → ürün config'i taşımak
// için tek yer; ton farkı burada.

export interface VoiceTone {
  /** 0-1; düşük = duygulu/dalgalı, yüksek = sabit/monoton. */
  stability: number;
  /** 0-1; ifade gücü (yüksek = daha duygulu vurgular). */
  style: number;
}

const STATE_TONE_DELTA: Record<ConversationState, VoiceTone> = {
  greeting: { stability: 0, style: 0 },
  identify: { stability: 0, style: 0 },
  remind: { stability: -0.05, style: 0.1 },
  negotiate: { stability: -0.15, style: 0.2 }, // en sıcak/empatik
  confirm: { stability: 0.1, style: -0.1 }, // net: tutar+tarih geri okuma
  escalate: { stability: -0.1, style: 0.05 }, // sakinleştirici, yumuşak
  closing: { stability: 0, style: 0.05 },
};

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/**
 * Konuşma durumuna göre TTS tonu. `base` = config'teki varsayılan stability/style.
 * Saf fonksiyon → delta tablosu test edilebilir.
 */
export function voiceToneForState(state: ConversationState, base: VoiceTone): VoiceTone {
  const delta = STATE_TONE_DELTA[state];
  return {
    stability: clamp01(base.stability + delta.stability),
    style: clamp01(base.style + delta.style),
  };
}

// --- 4) Düşünme dolgusu (gecikme maskeleme) ---------------------------------
// İnsan cevaplamadan önce "şey...", "bir bakayım..." der. STT-final → TTS-ilk-chunk
// boşluğunda kısa dolgu, hem hedefi hem robotik anındalığı gizler. Duruma uygun
// dolgu + tur indeksine göre rotasyon (aynı kalıbı tekrarlama).
const FILLERS: Record<ConversationState, readonly string[]> = {
  greeting: ['Şey,', 'Bir saniye,'],
  identify: ['Tabii,', 'Bir bakayım,'],
  remind: ['Şöyle,', 'Bakın,', 'Tabii,'],
  negotiate: ['Anlıyorum,', 'Şöyle yapalım,', 'Tabii,'],
  confirm: ['Hemen teyit edeyim,', 'Bir bakayım,'],
  escalate: ['Tabii,', 'Anlıyorum,'],
  closing: ['Peki,', 'Tabii,'],
};

/**
 * Duruma uygun kısa düşünme dolgusu. `turnIndex` ile rotasyon: aynı durumda
 * art arda aynı dolguyu söyleme (insan kalıp tekrarlamaz). Saf → test edilebilir.
 */
export function pickThinkingFiller(state: ConversationState, turnIndex = 0): string {
  const options = FILLERS[state];
  const idx = ((turnIndex % options.length) + options.length) % options.length;
  return options[idx]!;
}
