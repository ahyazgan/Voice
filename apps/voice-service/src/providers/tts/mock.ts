import type { AudioChunk, ITTSProvider, TTSOptions } from '@voice/shared';

export class MockTTS implements ITTSProvider {
  readonly name = 'mock';

  async *synthesizeStream(text: string, opts: TTSOptions): AsyncIterable<AudioChunk> {
    // Sessiz bir PCM bloğu döner; gerçek TTS sağlayıcısı yerine geçer.
    const samplesPerChunk = Math.max(1, Math.floor(opts.sampleRate / 50)); // 20ms
    const totalChunks = Math.max(1, Math.ceil(text.length / 10));
    for (let i = 0; i < totalChunks; i++) {
      yield {
        data: new Uint8Array(samplesPerChunk * 2),
        sampleRate: opts.sampleRate,
        encoding: 'pcm16',
      };
    }
  }
}
