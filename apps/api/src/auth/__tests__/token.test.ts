import { describe, it, expect } from 'vitest';
import { issueToken, verifyToken } from '../token.js';

const SECRET = 'test-secret-key';
const NOW = 1_000_000_000_000;

describe('issueToken / verifyToken', () => {
  it('üretilen token doğrulanır ve payload döner', () => {
    const t = issueToken('operator', SECRET, 12, NOW);
    const p = verifyToken(t, SECRET, NOW + 1000);
    expect(p?.sub).toBe('operator');
    expect(p?.exp).toBe(NOW + 12 * 3_600_000);
  });

  it('süresi dolmuş token reddedilir', () => {
    const t = issueToken('operator', SECRET, 1, NOW);
    const after = NOW + 2 * 3_600_000; // 2 saat sonra
    expect(verifyToken(t, SECRET, after)).toBeNull();
  });

  it('yanlış secret reddedilir', () => {
    const t = issueToken('operator', SECRET, 12, NOW);
    expect(verifyToken(t, 'wrong-secret', NOW + 1000)).toBeNull();
  });

  it('kurcalanmış payload reddedilir', () => {
    const t = issueToken('operator', SECRET, 12, NOW);
    const [, sig] = t.split('.');
    // payload'ı değiştir, imzayı koru → imza uyuşmaz
    const forged = `${Buffer.from(JSON.stringify({ sub: 'admin', exp: NOW + 9e9 })).toString('base64url')}.${sig}`;
    expect(verifyToken(forged, SECRET, NOW + 1000)).toBeNull();
  });

  it('bozuk token (nokta yok) reddedilir', () => {
    expect(verifyToken('garbage', SECRET, NOW)).toBeNull();
  });
});
