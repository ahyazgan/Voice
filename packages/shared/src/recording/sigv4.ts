// =============================================================================
// recording/sigv4.ts — AWS Signature V4 (saf, SDK'sız)
// =============================================================================
// S3-uyumlu storage'lara (S3, MinIO, Cloudflare R2, GCS S3 endpoint) imzalı
// PUT/DELETE isteği için Authorization header'ı üretir. SDK eklemeden, Node
// crypto ile. Tek-nesne PUT/DELETE'in ihtiyacı kadar; çok parçalı/streaming yok.
//
// Saf: (istek + kimlik + zaman) → header'lar. fetch çağrısını s3.ts yapar.
// Referans: https://docs.aws.amazon.com/general/latest/gr/sigv4-create-canonical-request.html
// =============================================================================

import { createHash, createHmac } from 'node:crypto';

export interface SigV4Input {
  method: 'PUT' | 'DELETE' | 'GET';
  /** Tam URL (https://host/path). Query imzalanmaz (basit PUT/DELETE). */
  url: string;
  region: string;
  service: string; // S3 için 's3'
  accessKeyId: string;
  secretAccessKey: string;
  /** İstek gövdesinin ham baytları (DELETE/GET için boş). */
  body: Uint8Array;
  contentType?: string;
  /** ISO zaman damgası — `YYYYMMDDTHHMMSSZ`. Test için enjekte; runtime'da amzDate(). */
  amzDate: string;
}

function sha256Hex(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex');
}
function hmac(key: Uint8Array | string, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

/** `Date` → AWS amz tarih biçimi `YYYYMMDDTHHMMSSZ`. */
export function amzDate(now: Date): string {
  return now.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

/**
 * SigV4 imzalı header'ları döndürür: Authorization + x-amz-date +
 * x-amz-content-sha256 (+ content-type). Bu header'larla fetch yapılır.
 */
export function signV4(input: SigV4Input): Record<string, string> {
  const u = new URL(input.url);
  const dateStamp = input.amzDate.slice(0, 8); // YYYYMMDD
  const payloadHash = sha256Hex(input.body);

  // Canonical headers (alfabetik, lowercase). content-type yalnızca varsa.
  const headers: Record<string, string> = {
    host: u.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': input.amzDate,
  };
  if (input.contentType) headers['content-type'] = input.contentType;

  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((h) => `${h}:${headers[h]}\n`).join('');
  const signedHeaders = signedHeaderNames.join(';');

  // Canonical URI: path'i path-segment bazında encode et (zaten encode'luysa bozma).
  const canonicalUri = u.pathname
    .split('/')
    .map((seg) => encodeURIComponent(decodeURIComponent(seg)))
    .join('/');

  const canonicalRequest = [
    input.method,
    canonicalUri,
    u.search.replace(/^\?/, ''), // canonical query (basit; sorted varsayımı)
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = `${dateStamp}/${input.region}/${input.service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    input.amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const kDate = hmac(`AWS4${input.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, input.region);
  const kService = hmac(kRegion, input.service);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return { ...headers, authorization };
}
