// =============================================================================
// recording/s3.ts — S3-uyumlu kayıt deposu (S3 / MinIO / R2 / GCS-S3)
// =============================================================================
// IRecordingStore'u SigV4 imzalı fetch ile uygular. AWS SDK yok. put() nesneyi
// `<endpoint>/<bucket>/<key>`'e yükler, kanonik URL döner; delete() süresi dolan
// kaydı siler. Key: recordings/<callId>.<ext> (deterministik → idempotent).
// =============================================================================

import type { IRecordingStore, RecordingStorePutOptions } from '../providers.js';
import { signV4, amzDate } from './sigv4.js';

export interface S3RecordingConfig {
  /** Örn. https://s3.eu-central-1.amazonaws.com veya https://<acct>.r2.cloudflarestorage.com */
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Public okuma için ayrı base (örn. CDN). Verilmezse endpoint/bucket kullanılır. */
  publicBaseUrl?: string;
}

const EXT_BY_TYPE: Record<string, string> = {
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/ogg': 'ogg',
};

export class S3RecordingStore implements IRecordingStore {
  readonly name = 's3';
  constructor(private readonly cfg: S3RecordingConfig, private readonly now: () => Date = () => new Date()) {}

  private objectUrl(key: string): string {
    return `${this.cfg.endpoint.replace(/\/$/, '')}/${this.cfg.bucket}/${key}`;
  }

  async put(data: Uint8Array, opts: RecordingStorePutOptions): Promise<string> {
    const ext = EXT_BY_TYPE[opts.contentType] ?? 'bin';
    const key = `recordings/${encodeURIComponent(opts.callId)}.${ext}`;
    const url = this.objectUrl(key);
    const headers = signV4({
      method: 'PUT',
      url,
      region: this.cfg.region,
      service: 's3',
      accessKeyId: this.cfg.accessKeyId,
      secretAccessKey: this.cfg.secretAccessKey,
      body: data,
      contentType: opts.contentType,
      amzDate: amzDate(this.now()),
    });

    const res = await fetch(url, { method: 'PUT', headers, body: data });
    if (!res.ok) {
      throw new Error(`S3 put başarısız: ${res.status} ${await safeText(res)}`);
    }
    // Public base verildiyse erişilebilir URL onunla; yoksa kanonik object URL.
    return this.cfg.publicBaseUrl
      ? `${this.cfg.publicBaseUrl.replace(/\/$/, '')}/${key}`
      : url;
  }

  async delete(url: string): Promise<void> {
    // publicBaseUrl döndürdüysek delete için kanonik object URL'ye geri çevir.
    const objectUrl =
      this.cfg.publicBaseUrl && url.startsWith(this.cfg.publicBaseUrl)
        ? this.objectUrl(url.slice(this.cfg.publicBaseUrl.replace(/\/$/, '').length + 1))
        : url;

    const headers = signV4({
      method: 'DELETE',
      url: objectUrl,
      region: this.cfg.region,
      service: 's3',
      accessKeyId: this.cfg.accessKeyId,
      secretAccessKey: this.cfg.secretAccessKey,
      body: new Uint8Array(0),
      amzDate: amzDate(this.now()),
    });
    const res = await fetch(objectUrl, { method: 'DELETE', headers });
    // 204 (silindi) ve 404 (zaten yok) ikisi de başarı sayılır (idempotent).
    if (!res.ok && res.status !== 404) {
      throw new Error(`S3 delete başarısız: ${res.status} ${await safeText(res)}`);
    }
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 200);
  } catch {
    return '';
  }
}
