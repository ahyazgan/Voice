import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { timingSafeEqual } from 'node:crypto';
import { env } from '../config.js';
import { issueToken, verifyToken } from '../auth/token.js';
import { hitLimit, type RateState } from '../auth/rateLimit.js';

const LoginSchema = z.object({ password: z.string() });

// /login brute-force kapısı: IP başına 5 dakikada en çok 10 deneme.
const loginAttempts = new Map<string, RateState>();
const LOGIN_MAX = 10;
const LOGIN_WINDOW_MS = 5 * 60 * 1000;

/** İki string'i sabit-zamanlı karşılaştırır (parola sızıntısını önler). */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/login', async (req, reply) => {
    // Brute-force kapısı (parola kontrolünden ÖNCE).
    if (hitLimit(loginAttempts, req.ip, Date.now(), LOGIN_MAX, LOGIN_WINDOW_MS)) {
      reply.code(429);
      return { error: 'too_many_attempts' };
    }
    // Auth yapılandırılmamışsa (yerel dev) login anlamsız.
    if (!env.PANEL_PASSWORD || !env.PANEL_AUTH_SECRET) {
      reply.code(503);
      return { error: 'auth_not_configured' };
    }
    const { password } = LoginSchema.parse(req.body);
    if (!safeEqual(password, env.PANEL_PASSWORD)) {
      reply.code(401);
      return { error: 'invalid_password' };
    }
    const token = issueToken('operator', env.PANEL_AUTH_SECRET, env.PANEL_TOKEN_TTL_HOURS);
    return { token, expiresInHours: env.PANEL_TOKEN_TTL_HOURS };
  });

  app.get('/me', async (req) => {
    // Auth kapalıysa açık dev kullanıcısı döner.
    if (!env.PANEL_AUTH_SECRET) return { user: { sub: 'dev', authDisabled: true } };
    const token = bearer(req.headers.authorization);
    const payload = token ? verifyToken(token, env.PANEL_AUTH_SECRET) : null;
    if (!payload) return { user: null };
    return { user: { sub: payload.sub } };
  });
}

export function bearer(header: string | undefined): string | null {
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim() || null;
}
