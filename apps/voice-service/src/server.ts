import { WebSocketServer } from 'ws';
import { createServer, type IncomingMessage } from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { DebtorSchema, type Debtor } from '@voice/shared';
import { env } from './config.js';
import { logger, LATENCY_TARGET_MS } from './telemetry.js';
import { loadProviders } from './providers/index.js';
import { Orchestrator } from './orchestrator.js';
import { startPlatformCall } from './phase1.js';
import { handleRetellWebSocket } from './providers/platform/retell.js';
import { handleVapiChatCompletion, type VapiChatRequest } from './providers/platform/vapi.js';
import { handleTelnyxMediaWs } from './providers/telephony/telnyx.js';

const providers = loadProviders();

/** Zod çıktısındaki `invoiceRef?: string | undefined`'i strict optional Debtor'a indirger. */
function toDebtor(d: z.infer<typeof DebtorSchema>): Debtor {
  const { invoiceRef, ...rest } = d;
  return invoiceRef !== undefined ? { ...rest, invoiceRef } : rest;
}

/**
 * Kontrol WS (/control) servis-içi kimlik doğrulaması. Worker INTERNAL_API_SECRET'i
 * Authorization: Bearer ile taşır. Secret yoksa (yerel dev) geçişe izin verilir ama
 * UYARI loglanır — production'da ayarlanmalı; aksi halde internete açık /control
 * yetkisiz arama başlatmaya (toll fraud / taciz) açık kalır.
 */
function controlAuthorized(req: IncomingMessage): boolean {
  const secret = env.INTERNAL_API_SECRET;
  if (!secret) {
    logger.warn('INTERNAL_API_SECRET yok — /control auth KAPALI (yalnızca dev)');
    return true;
  }
  const header = req.headers['authorization'] ?? '';
  const provided = header.startsWith('Bearer ') ? header.slice(7) : header;
  return secretEquals(provided, secret);
}

/** Sabit-zamanlı sır karşılaştırması. */
function secretEquals(provided: string, secret: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Vapi Custom-LLM POST'u: x-vapi-secret header'ını VAPI_SERVER_SECRET ile doğrular. */
function vapiAuthorized(req: IncomingMessage): boolean {
  const secret = env.VAPI_SERVER_SECRET;
  if (!secret) {
    logger.warn('VAPI_SERVER_SECRET yok — vapi-llm auth KAPALI (yalnızca dev)');
    return true;
  }
  const provided = req.headers['x-vapi-secret'];
  return typeof provided === 'string' && secretEquals(provided, secret);
}

/** Gelen WS upgrade'i: ?token= query'sini INBOUND_WS_TOKEN ile doğrular. */
function inboundTokenOk(req: IncomingMessage): boolean {
  const secret = env.INBOUND_WS_TOKEN;
  if (!secret) {
    logger.warn('INBOUND_WS_TOKEN yok — gelen WS auth KAPALI (yalnızca dev)');
    return true;
  }
  const token = new URL(req.url ?? '', 'http://x').searchParams.get('token') ?? '';
  return secretEquals(token, secret);
}

logger.info(
  {
    mode: env.VOICE_MODE,
    latencyTargetMs: LATENCY_TARGET_MS,
    providers: {
      platform: providers.platform.name,
      telephony: providers.telephony.name,
      stt: providers.stt.name,
      tts: providers.tts.name,
      llm: providers.llm.name,
    },
  },
  'voice-service starting',
);

if (env.VOICE_MODE === 'platform') {
  // Faz 1: ses akışı platformda. Bu portta İKİ WS rolü var, path'e göre ayrılır:
  //   /control               → worker'ın "arama başlat" (start) frame'ini dinler.
  //   /llm-websocket/:callId  → Retell'in Custom-LLM WS'i (her tur burada gelir).
  // Path routing için ham HTTP sunucu + `noServer` WSS'ler + upgrade dispatcher.
  const httpServer = createServer((req, res) => {
    const path = (req.url ?? '').split('?')[0] ?? '';
    // Liveness: LB/k8s probe'u (WS-only sunucuda HTTP health şart).
    if (req.method === 'GET' && path === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    // Vapi Custom-LLM: gelen OpenAI-uyumlu POST /vapi-llm/{callId}/chat/completions.
    const vapiMatch = path.match(/^\/vapi-llm\/(.+)\/chat\/completions$/);
    if (req.method === 'POST' && vapiMatch) {
      if (!vapiAuthorized(req)) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }
      const callId = decodeURIComponent(vapiMatch[1]!);
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c as Buffer));
      req.on('end', () => {
        void (async () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString()) as VapiChatRequest;
            const result = await handleVapiChatCompletion(callId, body);
            res.writeHead(result.status, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result.body));
          } catch (err) {
            logger.error({ err, callId }, 'vapi llm request failed');
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'internal' }));
          }
        })();
      });
      return;
    }
    // Diğer HTTP istekleri: WS dışı, kısa cevap.
    res.writeHead(426, { 'Content-Type': 'text/plain' });
    res.end('WebSocket only');
  });

  const controlWss = new WebSocketServer({ noServer: true });
  const llmWss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req, socket, head) => {
    const path = (req.url ?? '').split('?')[0] ?? '';

    if (path === '/control' || path === '/') {
      if (!controlAuthorized(req)) {
        socket.destroy();
        return;
      }
      controlWss.handleUpgrade(req, socket, head, (ws) => {
        controlWss.emit('connection', ws, req);
      });
      return;
    }

    // /llm-websocket/{callId} — son segment bizim callId.
    const llmMatch = path.match(/^\/llm-websocket\/(.+)$/);
    if (llmMatch) {
      if (!inboundTokenOk(req)) {
        socket.destroy();
        return;
      }
      const callId = decodeURIComponent(llmMatch[1]!);
      llmWss.handleUpgrade(req, socket, head, (ws) => {
        void handleRetellWebSocket(ws, callId);
      });
      return;
    }

    socket.destroy();
  });

  // --- control: worker → arama başlat -----------------------------------------
  controlWss.on('connection', (ws) => {
    ws.once('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        const parsed = DebtorSchema.safeParse(msg?.debtor);
        if (msg?.type !== 'start' || !parsed.success) {
          ws.close(1002, 'invalid start frame');
          return;
        }
        const callId = msg.callId ?? randomUUID();
        const session = await startPlatformCall({
          platform: providers.platform,
          llm: providers.llm,
          callContext: {
            callId,
            debtor: toDebtor(parsed.data),
            startedAt: new Date().toISOString(),
            consentToRecord: msg.consent === true,
          },
          onComplete: (reason) => {
            if (ws.readyState === ws.OPEN) ws.close(1000, reason);
          },
        });
        ws.send(JSON.stringify({ type: 'started', callId }));
        ws.on('close', () => void session.end('ws_closed'));
      } catch (err) {
        logger.error({ err }, 'platform start failed');
        ws.close(1011, 'internal');
      }
    });
  });

  httpServer.listen(env.VOICE_WS_PORT, () => {
    logger.info(
      { port: env.VOICE_WS_PORT, mode: 'platform', paths: ['/control', '/llm-websocket/:callId'] },
      'platform ws listening',
    );
  });
} else {
  // Faz 2: kendi cascade. İki WS rolü, path'e göre ayrılır (platform dalıyla aynı kalıp):
  //   /control                → worker'ın "arama başlat" frame'i → placeCall + Orchestrator.
  //   /telnyx-media/:callId    → Telnyx'in INBOUND media stream'i (ses buradan akar).
  const httpServer = createServer((req, res) => {
    const path = (req.url ?? '').split('?')[0] ?? '';
    if (req.method === 'GET' && path === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    res.writeHead(426, { 'Content-Type': 'text/plain' });
    res.end('WebSocket only');
  });

  const controlWss = new WebSocketServer({ noServer: true });
  const mediaWss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req, socket, head) => {
    const path = (req.url ?? '').split('?')[0] ?? '';

    if (path === '/control' || path === '/') {
      if (!controlAuthorized(req)) {
        socket.destroy();
        return;
      }
      controlWss.handleUpgrade(req, socket, head, (ws) => controlWss.emit('connection', ws, req));
      return;
    }
    const mediaMatch = path.match(/^\/telnyx-media\/(.+)$/);
    if (mediaMatch) {
      if (!inboundTokenOk(req)) {
        socket.destroy();
        return;
      }
      const callId = decodeURIComponent(mediaMatch[1]!);
      mediaWss.handleUpgrade(req, socket, head, (ws) => handleTelnyxMediaWs(ws, callId));
      return;
    }
    socket.destroy();
  });

  controlWss.on('connection', (ws) => {
    ws.once('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        const parsed = DebtorSchema.safeParse(msg?.debtor);
        if (msg?.type !== 'start' || !parsed.success) {
          ws.close(1002, 'invalid start frame');
          return;
        }
        const callId = msg.callId ?? randomUUID();
        const session = await providers.telephony.placeCall({
          callId,
          to: parsed.data.phoneE164,
          from: msg.from ?? '+900000000000',
        });
        const orchestrator = new Orchestrator(
          { stt: providers.stt, tts: providers.tts, llm: providers.llm },
          {
            callContext: {
              callId,
              debtor: toDebtor(parsed.data),
              startedAt: new Date().toISOString(),
              consentToRecord: msg.consent === true,
            },
            session,
            // Gerçek telefon hattı 8kHz μ-law taşır (Deepgram μ-law/8000, ElevenLabs
            // ulaw_8000 → uçtan uca resample gerekmez). Mock telephony yerel/WAV
            // testinde 16k kullanabilir. msg.sampleRate her zaman önceliklidir.
            sampleRate: msg.sampleRate ?? (providers.telephony.name === 'mock' ? 16000 : 8000),
            onShutdown: (reason) => {
              if (ws.readyState === ws.OPEN) ws.close(1000, reason);
            },
          },
        );
        await orchestrator.start();
        ws.on('close', () => void orchestrator.shutdown('ws_closed'));
      } catch (err) {
        logger.error({ err }, 'cascade start failed');
        ws.close(1011, 'internal');
      }
    });
  });

  httpServer.listen(env.VOICE_WS_PORT, () => {
    logger.info(
      { port: env.VOICE_WS_PORT, mode: 'cascade', paths: ['/control', '/telnyx-media/:callId'] },
      'cascade ws listening',
    );
  });
}
