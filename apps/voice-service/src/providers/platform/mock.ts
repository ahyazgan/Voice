import type {
  IOrchestrationPlatform,
  PlatformCallOptions,
  PlatformCallSession,
} from '@voice/shared';
import { logger } from '../../telemetry.js';

/**
 * Mock orkestrasyon platformu — gerçek Retell/Vapi entegrasyonu henüz yok.
 * `startCall` çağrıldığında platformun yapacağını simüle eder:
 *   1. Açılış cümlesini (rıza anonsu) seslendirdiğini farz eder.
 *   2. Sahte bir müşteri turu üretip `onTurn`'ü çağırır.
 *   3. Karar `shouldHangup` ise oturumu kapatır.
 *
 * Gerçek platform adaptörü (`retell.ts` vb.) implemente edilirken bu sınıf referans alınır.
 */
class MockPlatformSession implements PlatformCallSession {
  private closed = false;
  constructor(public readonly callId: string) {}

  async end(reason?: string): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    logger.info({ callId: this.callId, reason }, 'mock platform session ended');
  }
}

export class MockOrchestrationPlatform implements IOrchestrationPlatform {
  readonly name = 'mock';

  async startCall(opts: PlatformCallOptions): Promise<PlatformCallSession> {
    const session = new MockPlatformSession(opts.callContext.callId);
    logger.info(
      { callId: opts.callContext.callId, opening: opts.openingUtterance },
      'mock platform: opening utterance scheduled',
    );

    // Gerçek platform burada müşteriyle çift yönlü ses akışı başlatır.
    // Mock: tek bir sahte tur üretip handler'a iletelim ki entegrasyon yolu doğrulansın.
    queueMicrotask(async () => {
      try {
        const decision = await opts.onTurn({ userText: '[mock] merhaba', turnIndex: 0 });
        logger.info({ callId: opts.callContext.callId, decision }, 'mock platform: turn complete');
        if (decision.shouldHangup) {
          opts.onEnd?.({
            reason: `state_terminal:${decision.outcome ?? 'unknown'}`,
            transcript: [],
            ...(decision.outcome !== undefined && { outcome: decision.outcome }),
          });
          await session.end('state_terminal');
        }
      } catch (err) {
        logger.error({ err }, 'mock platform turn failed');
      }
    });

    return session;
  }
}
