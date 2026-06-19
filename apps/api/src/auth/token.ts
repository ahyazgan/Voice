// =============================================================================
// auth/token.ts — panel için sıfır-bağımlılık imzalı bearer token
// =============================================================================
// Tek paylaşılan parola sonrası operatöre verilen token. JWT kütüphanesi yok;
// Node crypto HMAC-SHA256 ile `<payloadB64url>.<sigB64url>`. Tek-kullanıcı/küçük
// ekip için yeterli (rol/çok-kullanıcı gerekirse gerçek IAM ayrı iş).
// =============================================================================

import { createHmac, timingSafeEqual } from 'node:crypto';

interface TokenPayload {
  sub: string; // kullanıcı/etiket (örn. 'operator')
  exp: number; // epoch ms
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64url(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}
function sign(payloadB64: string, secret: string): string {
  return b64url(createHmac('sha256', secret).update(payloadB64).digest());
}

/** Verilen sub için ttlHours geçerli imzalı token üretir. `now` test için. */
export function issueToken(sub: string, secret: string, ttlHours: number, now: number = Date.now()): string {
  const payload: TokenPayload = { sub, exp: now + ttlHours * 3_600_000 };
  const payloadB64 = b64url(Buffer.from(JSON.stringify(payload)));
  return `${payloadB64}.${sign(payloadB64, secret)}`;
}

/**
 * Token'ı doğrular: imza geçerli + süresi dolmamış. Geçerliyse payload döner,
 * değilse null. timingSafeEqual ile imza karşılaştırması (zamanlama sızıntısı yok).
 */
export function verifyToken(token: string, secret: string, now: number = Date.now()): TokenPayload | null {
  const dot = token.indexOf('.');
  if (dot < 0) return null;
  const payloadB64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  const expected = sign(payloadB64, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let payload: TokenPayload;
  try {
    payload = JSON.parse(fromB64url(payloadB64).toString('utf8'));
  } catch {
    return null;
  }
  if (typeof payload.exp !== 'number' || payload.exp < now) return null;
  return payload;
}
