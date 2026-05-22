import { EventEmitter } from 'node:events';
import type {
  AudioChunk,
  ITelephonyProvider,
  PlaceCallOptions,
  TelephonySession,
} from '@voice/shared';

class MockTelephonySession implements TelephonySession {
  private emitter = new EventEmitter();

  constructor(public readonly callId: string) {}

  onAudio(handler: (chunk: AudioChunk) => void): void {
    this.emitter.on('audio', handler);
  }

  onHangup(handler: () => void): void {
    this.emitter.on('hangup', handler);
  }

  sendAudio(_chunk: AudioChunk): void {
    // no-op for mock
  }

  stopPlayback(): void {
    // no-op for mock; gerçek sağlayıcıda telefon kuyruğunu boşaltır
  }

  async hangup(_reason?: string): Promise<void> {
    this.emitter.emit('hangup');
    this.emitter.removeAllListeners();
  }
}

export class MockTelephony implements ITelephonyProvider {
  readonly name = 'mock';

  async placeCall(opts: PlaceCallOptions): Promise<TelephonySession> {
    return new MockTelephonySession(opts.callId);
  }
}
