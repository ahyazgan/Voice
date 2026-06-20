import { WebSocketServer } from 'ws';
import { createServer, type IncomingMessage } from 'node:http';
import { randomUUID } from 'node:crypto';
import { env, assertProductionSafe, controlAuthSecret, secretsMatch } from './config.js';
import { logger, LATENCY_TARGET_MS } from './telemetry.js';

// Üretimde tehlikeli varsayılanları (mock provider, kimliksiz endpoint, İngilizce
// ses) başlamadan reddet. Dev/test'te no-op.
assertProductionSafe();

/**
 * `/control` WS upgrade'inde kimlik doğrular. Sır CONTROL_AUTH_SECRET (yoksa
 * INTERNAL_API_SECRET). Sır TANIMLI DEĞİLSE (dev) auth atlanır; tanımlıysa
 * `x-internal-secret` header'ı VEYA `?token=` query'si eşleşmeli.
 * Eşleşmezse 401 ile socket kapatılır (WS handshake hiç kurulmaz).
 */
function controlUpgradeAuthorized(req: IncomingMessage): boolean {
  const secret = controlAuthSecret();
  if (!secret) return true; // dev: sır yoksa açık (assertProductionSafe üretimde zorlar)
  const header = req.headers['x-internal-secret'];
  const headerVal = Array.isArray(header) ? header[0] : header;
  if (secretsMatch(headerVal, secret)) return true;
  const url = new URL(req.url ?? '/', 'http://localhost');
  return secretsMatch(url.searchParams.get('token') ?? undefined, secret);
}
import { loadProviders } from './providers/index.js';
import { Orchestrator } from './orchestrator.js';
import { startPlatformCall } from './phase1.js';
import { handleRetellWebSocket } from './providers/platform/retell.js';
import { handleVapiChatCompletion, type VapiChatRequest } from './providers/platform/vapi.js';
import { handleTelnyxMediaWs } from './providers/telephony/telnyx.js';
import {
  verifyRetellSignature,
  extractCallEnded,
  type RetellWebhookBody,
} from './providers/platform/retellWebhook.js';
import { retellWebhookKey } from './config.js';
import { postRecordingCost } from './persist.js';

const providers = loadProviders();

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
    // Health probe (K8s/LB): süreç ayakta + aktif provider'lar. Auth gerektirmez.
    if (req.method === 'GET' && path === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: true,
          mode: env.VOICE_MODE,
          providers: { platform: providers.platform.name, llm: providers.llm.name },
        }),
      );
      return;
    }
    // Retell event webhook: POST /retell-webhook (call_started/ended/analyzed).
    // İmza HAM gövde üstünden doğrulanır → recording_url + cost geri-çekilir.
    if (req.method === 'POST' && path === '/retell-webhook') {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c as Buffer));
      req.on('end', () => {
        const rawBody = Buffer.concat(chunks).toString();
        const key = retellWebhookKey();
        // Key tanımlıysa imza ZORUNLU. Tanımsızsa (dev) atlanır; üretimde
        // assertProductionSafe değil ama operatör webhook'u açtıysa key vermeli.
        if (key) {
          const sig = req.headers['x-retell-signature'];
          const sigVal = Array.isArray(sig) ? sig[0] : sig;
          if (!verifyRetellSignature(rawBody, sigVal, key)) {
            logger.warn('retell webhook reddedildi: imza geçersiz/eski');
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'unauthorized' }));
            return;
          }
        }
        // İmza geçerli (veya dev). 200 hemen dön (Retell retry'ı tetiklenmesin),
        // işi arka planda yap.
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        try {
          const body = JSON.parse(rawBody) as RetellWebhookBody;
          const ended = extractCallEnded(body);
          if (ended?.callId) {
            void postRecordingCost({
              callId: ended.callId,
              ...(ended.recordingUrl !== undefined && { recordingUrl: ended.recordingUrl }),
              ...(ended.durationSec !== undefined && { durationSec: ended.durationSec }),
              ...(ended.costMinor !== undefined && { platformCostMinor: ended.costMinor }),
            });
          }
        } catch (err) {
          logger.warn({ err }, 'retell webhook parse/forward failed');
        }
      });
      return;
    }
    // Vapi Custom-LLM: gelen OpenAI-uyumlu POST /vapi-llm/{callId}/chat/completions.
    const vapiMatch = path.match(/^\/vapi-llm\/(.+)\/chat\/completions$/);
    if (req.method === 'POST' && vapiMatch) {
      const callId = decodeURIComponent(vapiMatch[1]!);
      // Vapi Custom-LLM POST'unu doğrula: VAPI_SECRET tanımlıysa `x-vapi-secret`
      // header'ı eşleşmeli. Tanımlı değilse (dev) atlanır; üretimde
      // assertProductionSafe VAPI_SECRET'ı zorlar. Eşleşmezse sahte tur
      // enjeksiyonunu (uydurma PROMISE_TO_PAY) engelle.
      if (env.VAPI_SECRET) {
        const sig = req.headers['x-vapi-secret'];
        const sigVal = Array.isArray(sig) ? sig[0] : sig;
        if (!secretsMatch(sigVal, env.VAPI_SECRET)) {
          logger.warn({ callId }, 'vapi POST reddedildi: x-vapi-secret eşleşmedi');
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'unauthorized' }));
          return;
        }
      }
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
      if (!controlUpgradeAuthorized(req)) {
        logger.warn({ path }, 'control upgrade reddedildi: auth başarısız');
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
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
        if (msg.type !== 'start' || !msg.debtor) {
          ws.close(1002, 'expected start frame');
          return;
        }
        const callId = msg.callId ?? randomUUID();
        const session = await startPlatformCall({
          platform: providers.platform,
          llm: providers.llm,
          callContext: {
            callId,
            debtor: msg.debtor,
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
      res.end(
        JSON.stringify({
          ok: true,
          mode: env.VOICE_MODE,
          providers: {
            telephony: providers.telephony.name,
            stt: providers.stt.name,
            tts: providers.tts.name,
            llm: providers.llm.name,
          },
        }),
      );
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
      if (!controlUpgradeAuthorized(req)) {
        logger.warn({ path }, 'control upgrade reddedildi: auth başarısız');
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      controlWss.handleUpgrade(req, socket, head, (ws) => controlWss.emit('connection', ws, req));
      return;
    }
    const mediaMatch = path.match(/^\/telnyx-media\/(.+)$/);
    if (mediaMatch) {
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
        if (msg.type !== 'start' || !msg.debtor) {
          ws.close(1002, 'expected start frame');
          return;
        }
        const callId = msg.callId ?? randomUUID();
        const session = await providers.telephony.placeCall({
          callId,
          to: msg.debtor.phoneE164,
          from: msg.from ?? '+900000000000',
        });
        const orchestrator = new Orchestrator(
          { stt: providers.stt, tts: providers.tts, llm: providers.llm },
          {
            callContext: {
              callId,
              debtor: msg.debtor,
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
