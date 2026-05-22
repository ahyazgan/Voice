import { WebSocketServer } from 'ws';
import { randomUUID } from 'node:crypto';
import { env } from './config.js';
import { logger, LATENCY_TARGET_MS } from './telemetry.js';
import { loadProviders } from './providers/index.js';
import { Orchestrator } from './orchestrator.js';
import { startPlatformCall } from './phase1.js';

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
  // Faz 1: ses akışı platformda. Buradaki WS sunucu yalnızca "arama başlat"
  // komutlarını dinler; gerçek ses yolu platform tarafından kurulur.
  const wss = new WebSocketServer({ port: env.VOICE_WS_PORT });
  logger.info({ port: env.VOICE_WS_PORT, mode: 'platform' }, 'control ws listening');

  wss.on('connection', (ws) => {
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
} else {
  // Faz 2: kendi cascade. Telefon sağlayıcı ses akışını bu WS'ye bağlar.
  const wss = new WebSocketServer({ port: env.VOICE_WS_PORT });
  logger.info({ port: env.VOICE_WS_PORT, mode: 'cascade' }, 'audio ws listening');

  wss.on('connection', (ws) => {
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
            sampleRate: msg.sampleRate ?? 16000,
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
}
