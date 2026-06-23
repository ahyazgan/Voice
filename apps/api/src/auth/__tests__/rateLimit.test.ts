// =============================================================================
// rateLimit.test.ts — sabit-pencere hız sınırı (saf)
// =============================================================================
import { describe, it, expect } from 'vitest';
import { hitLimit, type RateState } from '../rateLimit.js';

describe('hitLimit', () => {
  it('max`a kadar izin verir, aşınca engeller', () => {
    const store = new Map<string, RateState>();
    const t = 1000;
    // max=3: ilk 3 izinli (false), 4. engellenir (true)
    expect(hitLimit(store, 'ip', t, 3, 60_000)).toBe(false);
    expect(hitLimit(store, 'ip', t, 3, 60_000)).toBe(false);
    expect(hitLimit(store, 'ip', t, 3, 60_000)).toBe(false);
    expect(hitLimit(store, 'ip', t, 3, 60_000)).toBe(true);
  });

  it('pencere dolunca sıfırlanır', () => {
    const store = new Map<string, RateState>();
    expect(hitLimit(store, 'ip', 0, 1, 1000)).toBe(false);
    expect(hitLimit(store, 'ip', 500, 1, 1000)).toBe(true); // pencere içinde aşıldı
    expect(hitLimit(store, 'ip', 1000, 1, 1000)).toBe(false); // pencere doldu → reset
  });

  it('farklı IP`ler bağımsız sayılır', () => {
    const store = new Map<string, RateState>();
    expect(hitLimit(store, 'a', 0, 1, 1000)).toBe(false);
    expect(hitLimit(store, 'a', 0, 1, 1000)).toBe(true);
    expect(hitLimit(store, 'b', 0, 1, 1000)).toBe(false); // b ayrı
  });
});
