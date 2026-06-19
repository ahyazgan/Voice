import { describe, it, expect } from 'vitest';
import { SayStreamExtractor } from '../providers/llm/sayStream.js';

/** Bir tam JSON'u parça parça besleyip yield edilen cümleleri toplar. */
function feed(json: string, chunkSize: number): { sentences: string[]; fullSay: string } {
  const ex = new SayStreamExtractor();
  const sentences: string[] = [];
  for (let i = 0; i < json.length; i += chunkSize) {
    sentences.push(...ex.push(json.slice(i, i + chunkSize)));
  }
  sentences.push(...ex.flush());
  return { sentences, fullSay: ex.fullSay };
}

describe('SayStreamExtractor', () => {
  it('tek cümlelik say → tam çıkar', () => {
    const json = '{"say":"Merhaba.","intent":"NO_RESPONSE","fields":null}';
    const { sentences, fullSay } = feed(json, 3);
    expect(fullSay).toBe('Merhaba.');
    expect(sentences.join(' ')).toBe('Merhaba.');
  });

  it('çok cümle → cümle sınırında parçalar', () => {
    const json = '{"say":"Merhaba Ayşe Hanım. Borcunuzu hatırlatmak istedim. Ödeyebilir misiniz?","intent":"NO_RESPONSE","fields":null}';
    const { sentences } = feed(json, 5);
    expect(sentences).toEqual([
      'Merhaba Ayşe Hanım.',
      'Borcunuzu hatırlatmak istedim.',
      'Ödeyebilir misiniz?',
    ]);
  });

  it('token token (1 karakter) beslemede de doğru', () => {
    const json = '{"say":"Tamam. Teşekkürler!","intent":"CONFIRMED","fields":null}';
    const { sentences, fullSay } = feed(json, 1);
    expect(fullSay).toBe('Tamam. Teşekkürler!');
    expect(sentences).toEqual(['Tamam.', 'Teşekkürler!']);
  });

  it('JSON kaçışlı tırnak say içinde → değeri bozmaz', () => {
    const json = '{"say":"O dedi ki \\"yarın\\" öderim.","intent":"WILL_PAY","fields":null}';
    const { fullSay } = feed(json, 4);
    expect(fullSay).toBe('O dedi ki "yarın" öderim.');
  });

  it('say bitmeden cümle yoksa flush yarım kalanı verir', () => {
    const json = '{"say":"Bir saniye","intent":"NO_RESPONSE","fields":null}';
    const { sentences } = feed(json, 2);
    expect(sentences).toEqual(['Bir saniye']);
  });

  it('say öncesi başka alan olsa da bulur', () => {
    // (schema sırası say'i önce koyuyor ama dayanıklılık testi)
    const json = '{"intent":"NO_RESPONSE","say":"Anladım."}';
    const { fullSay } = feed(json, 3);
    expect(fullSay).toBe('Anladım.');
  });
});
