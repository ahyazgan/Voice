import { EventEmitter } from 'node:events';
import type { AudioChunk, ISTTProvider, STTEvent, STTOptions, STTSession } from '@voice/shared';

class MockSTTSession implements STTSession {
  private emitter = new EventEmitter();
  private buffered = 0;

  push(chunk: AudioChunk): void {
    this.buffered += chunk.data.byteLength;
    // Bu mock yalnızca iskelet; gerçek STT'de partial/final eventleri sağlayıcı üretir.
  }

  onEvent(handler: (evt: STTEvent) => void): void {
    this.emitter.on('event', handler);
  }

  emitFinal(text: string, durationMs: number): void {
    this.emitter.emit('event', { type: 'final', text, durationMs } satisfies STTEvent);
  }

  async close(): Promise<void> {
    this.emitter.removeAllListeners();
    this.buffered = 0;
  }
}

export class MockSTT implements ISTTProvider {
  readonly name = 'mock';

  createSession(_opts: STTOptions): STTSession {
    return new MockSTTSession();
  }
}
