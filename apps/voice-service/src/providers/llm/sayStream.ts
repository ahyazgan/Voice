// =============================================================================
// sayStream.ts — streaming JSON'dan `say` değerini cümle cümle çıkarır
// =============================================================================
// LLM yapılandırılmış çıktıyı ({ "say": "...", "intent": ... }) token token
// akıtır. Biz `say` string'inin değerini incremental yakalayıp CÜMLE SINIRINDA
// (. ! ? veya yeterli uzunluk) parça yield ederiz → TTS hemen başlar, intent
// JSON bitince gelir. Bu gecikme kazancının çekirdeği.
//
// Saf sınıf, I/O yok → test edilebilir. JSON kaçışlarını (\", \\, \n) doğru çözer.
// =============================================================================

/** Cümle sınırı: nokta/ünlem/soru + (boşluk veya son). */
const SENTENCE_END = /[.!?…]/;

export class SayStreamExtractor {
  private buf = ''; // ham JSON akümülatörü
  private sayValue = ''; // çözülmüş say içeriği (tam)
  private emitted = 0; // sayValue'dan kaç karakter yield edildi
  private inSay = false; // "say" değerinin İÇİNDE miyiz
  private sayDone = false; // say string kapandı mı
  private escape = false; // bir önceki karakter ters-eğik miydi

  /**
   * Yeni token ekler, yield edilmeye HAZIR tam cümle(ler) varsa döndürür.
   * say henüz bitmemişse yalnızca cümle-tamamlanmış kısımları verir.
   */
  push(token: string): string[] {
    this.buf += token;
    if (!this.inSay && !this.sayDone) this.tryEnterSay();
    if (this.inSay) this.consumeSayChars();
    return this.drainSentences(false);
  }

  /** Akış bitti: say'in kalan tüm içeriğini (yarım cümle dahil) yield et. */
  flush(): string[] {
    return this.drainSentences(true);
  }

  /** Tüm say değeri (tam çözülmüş). respond fallback / loglama için. */
  get fullSay(): string {
    return this.sayValue;
  }

  // "say" anahtarının açılış tırnağını bul, değerin içine gir.
  private tryEnterSay(): void {
    const m = this.buf.match(/"say"\s*:\s*"/);
    if (m && m.index !== undefined) {
      this.inSay = true;
      // Değerin başladığı pozisyondan sonrasını ham olarak işlemeye bırak.
      this.pending = this.buf.slice(m.index + m[0].length);
      this.buf = ''; // artık pending üzerinden ilerleriz
    }
  }

  private pending = ''; // say değeri için işlenmemiş ham karakterler

  private consumeSayChars(): void {
    // push() buf'a ekledi; inSay'e yeni girdiyse pending zaten dolduruldu,
    // sonraki push'larda buf'a gelenleri pending'e taşı.
    if (this.buf) {
      this.pending += this.buf;
      this.buf = '';
    }
    let i = 0;
    while (i < this.pending.length && !this.sayDone) {
      const ch = this.pending[i]!;
      if (this.escape) {
        // JSON kaçışları → gerçek karakter.
        this.sayValue += ch === 'n' ? '\n' : ch === 't' ? '\t' : ch;
        this.escape = false;
      } else if (ch === '\\') {
        this.escape = true;
      } else if (ch === '"') {
        this.sayDone = true;
        this.inSay = false;
      } else {
        this.sayValue += ch;
      }
      i++;
    }
    this.pending = this.pending.slice(i);
  }

  // sayValue'dan henüz yield edilmemiş tam cümleleri (force ise hepsini) çıkar.
  private drainSentences(force: boolean): string[] {
    const out: string[] = [];
    let rest = this.sayValue.slice(this.emitted);

    if (force) {
      const tail = rest.trim();
      if (tail) out.push(tail);
      this.emitted = this.sayValue.length;
      return out;
    }

    // Tam cümleleri sırayla kes.
    let searchFrom = 0;
    while (true) {
      const m = SENTENCE_END.exec(rest.slice(searchFrom));
      if (!m) break;
      const end = searchFrom + m.index + 1;
      const sentence = rest.slice(0, end).trim();
      if (sentence) out.push(sentence);
      this.emitted += end;
      rest = rest.slice(end);
      searchFrom = 0;
    }
    return out;
  }
}
