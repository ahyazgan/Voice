import { describe, it, expect } from 'vitest';
import { secretsMatch } from '../config.js';

describe('secretsMatch (sabit-zamanlı sır karşılaştırması)', () => {
  it('aynı sırlar eşleşir', () => {
    expect(secretsMatch('s3cr3t-value', 's3cr3t-value')).toBe(true);
  });

  it('farklı sırlar eşleşmez', () => {
    expect(secretsMatch('s3cr3t-value', 's3cr3t-other')).toBe(false);
  });

  it('uzunluk farkı eşleşmez (timingSafeEqual patlatmaz)', () => {
    expect(secretsMatch('short', 'a-much-longer-secret')).toBe(false);
  });

  it('provided boş/undefined → false', () => {
    expect(secretsMatch(undefined, 'secret')).toBe(false);
    expect(secretsMatch('', 'secret')).toBe(false);
  });

  it('expected boş/undefined → false (sır tanımsızken asla geçme)', () => {
    expect(secretsMatch('secret', undefined)).toBe(false);
    expect(secretsMatch('secret', '')).toBe(false);
  });
});
