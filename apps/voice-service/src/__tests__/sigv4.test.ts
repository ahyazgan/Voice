// =============================================================================
// sigv4.test.ts — AWS SigV4 imza helper'ı (@voice/shared, S3 kayıt deposu için)
// =============================================================================
// S3 olmadan imza mantığını kilitler: deterministik, girdiye duyarlı, doğru format.
// =============================================================================

import { describe, it, expect } from 'vitest';
import { signV4, amzDate, type SigV4Input } from '@voice/shared';

const base: SigV4Input = {
  method: 'PUT',
  url: 'https://s3.eu-central-1.amazonaws.com/bucket/recordings/call_1.wav',
  region: 'eu-central-1',
  service: 's3',
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  body: new Uint8Array([1, 2, 3]),
  contentType: 'audio/wav',
  amzDate: '20260615T120000Z',
};

describe('signV4', () => {
  it('deterministik: aynı girdi → aynı imza', () => {
    expect(signV4(base).authorization).toBe(signV4({ ...base }).authorization);
  });

  it('Authorization doğru formatta', () => {
    const h = signV4(base);
    expect(h.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/20260615\/eu-central-1\/s3\/aws4_request, SignedHeaders=[-a-z0-9;]+, Signature=[0-9a-f]{64}$/,
    );
  });

  it('imzalı header listesi content-type dahil sıralı', () => {
    const h = signV4(base);
    expect(h.authorization).toContain(
      'SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date',
    );
    expect(h['x-amz-content-sha256']).toMatch(/^[0-9a-f]{64}$/);
    expect(h['x-amz-date']).toBe('20260615T120000Z');
  });

  it('gövde değişince imza değişir', () => {
    const other = signV4({ ...base, body: new Uint8Array([9, 9, 9]) });
    expect(other.authorization).not.toBe(signV4(base).authorization);
  });

  it('zaman değişince imza değişir', () => {
    const other = signV4({ ...base, amzDate: '20260616T120000Z' });
    expect(other.authorization).not.toBe(signV4(base).authorization);
  });

  it('DELETE (boş gövde) imzalanır, content-type yok', () => {
    const { contentType: _omit, ...noContentType } = base;
    const h = signV4({ ...noContentType, method: 'DELETE', body: new Uint8Array(0) });
    expect(h.authorization).toContain('SignedHeaders=host;x-amz-content-sha256;x-amz-date');
    expect(h['x-amz-content-sha256']).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('amzDate: Date → YYYYMMDDTHHMMSSZ', () => {
    expect(amzDate(new Date('2026-06-15T12:00:00.000Z'))).toBe('20260615T120000Z');
  });
});
