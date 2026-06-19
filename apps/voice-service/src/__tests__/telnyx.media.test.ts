// =============================================================================
// telnyx.media.test.ts — Telnyx inbound media köprüsü (gerçek hat YOK)
// =============================================================================
// placeCall REST'ini (fetch mock) + handleTelnyxMediaWs köprüsünü sınar:
//   - gelen media event base64 → AudioChunk (pcmu/8000) onAudio'ya gider,
//   - sendAudio → doğru base64 media event üretir,
//   - stopPlayback → 'clear' event,
//   - stop event → onHangup tetiklenir,
//   - eşleşmeyen callId → 1011 close.
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { WebSocket } from 'ws';
import type { AudioChunk } from '@voice/shared';
import { TelnyxTelephonyProvider, handleTelnyxMediaWs } from '../providers/telephony/telnyx.js';

class FakeWs extends EventEmitter {
  readonly OPEN = 1;
  readyState = 1;
  sent: unknown[] = [];
  closedCode: number | null = null;
  send(d: string): void { this.sent.push(JSON.parse(d)); }
  close(code?: number): void { this.closedCode = code ?? 1000; this.emit('close'); }
  feed(event: unknown): void { this.emit('message', Buffer.from(JSON.stringify(event))); }
}

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function provider() {
  return new TelnyxTelephonyProvider({
    apiKey: 'sk', connectionId: 'conn', fromNumberE164: '+908500000000',
    publicWsBase: 'wss://host.example',
  });
}

describe('TelnyxTelephonyProvider.placeCall', () => {
  it('Call Control dial REST\'ini stream_url ile çağırır', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ data: { call_control_id: 'cc1' } }) });
    await provider().placeCall({ callId: 'call_1', to: '+905551112233', from: '' });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.telnyx.com/v2/calls');
    const body = JSON.parse((init as { body: string }).body);
    expect(body.to).toBe('+905551112233');
    expect(body.stream_url).toBe('wss://host.example/telnyx-media/call_1');
    expect(body.stream_track).toBe('inbound_track');
  });

  it('REST hata → fırlatır', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 422 });
    await expect(provider().placeCall({ callId: 'c', to: '+90', from: '' })).rejects.toThrow(/422/);
  });
});

describe('handleTelnyxMediaWs köprüsü', () => {
  async function place(callId: string) {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ data: { call_control_id: 'cc' } }) });
    return provider().placeCall({ callId, to: '+905551112233', from: '' });
  }

  it('media event → AudioChunk (pcmu/8000) onAudio\'ya gider', async () => {
    const session = await place('call_media');
    const chunks: AudioChunk[] = [];
    session.onAudio((c) => chunks.push(c));

    const ws = new FakeWs();
    handleTelnyxMediaWs(ws as unknown as WebSocket, 'call_media');
    const payload = Buffer.from([0xff, 0x7f, 0x00]).toString('base64');
    ws.feed({ event: 'media', media: { payload } });

    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.encoding).toBe('pcmu');
    expect(chunks[0]!.sampleRate).toBe(8000);
    expect([...chunks[0]!.data]).toEqual([0xff, 0x7f, 0x00]);
  });

  it('sendAudio → base64 media event; stopPlayback → clear', async () => {
    const session = await place('call_send');
    const ws = new FakeWs();
    handleTelnyxMediaWs(ws as unknown as WebSocket, 'call_send');

    session.sendAudio({ data: new Uint8Array([1, 2, 3]), sampleRate: 8000, encoding: 'pcmu' });
    expect(ws.sent[0]).toEqual({ event: 'media', media: { payload: Buffer.from([1, 2, 3]).toString('base64') } });

    session.stopPlayback();
    expect(ws.sent[1]).toEqual({ event: 'clear' });
  });

  it('stop event → onHangup tetiklenir', async () => {
    const session = await place('call_stop');
    const onHangup = vi.fn();
    session.onHangup(onHangup);
    const ws = new FakeWs();
    handleTelnyxMediaWs(ws as unknown as WebSocket, 'call_stop');

    ws.feed({ event: 'stop' });
    expect(onHangup).toHaveBeenCalled();
  });

  it('eşleşmeyen callId → 1011 close', () => {
    const ws = new FakeWs();
    handleTelnyxMediaWs(ws as unknown as WebSocket, 'nope');
    expect(ws.closedCode).toBe(1011);
  });
});
