// =============================================================================
// recording/index.ts — kayıt deposu seçimi (env-bağımsız factory)
// =============================================================================
// Hem voice-service (put) hem api (delete) bu factory'yi kullanır ki kayıt aynı
// store ile yüklenir ve silinir. Config çağıran app'in env'inden gelir.
// =============================================================================

import type { IRecordingStore } from '../providers.js';
import { NoneRecordingStore } from './none.js';
import { S3RecordingStore, type S3RecordingConfig } from './s3.js';

export { NoneRecordingStore } from './none.js';
export { S3RecordingStore, type S3RecordingConfig } from './s3.js';
export { signV4, amzDate, type SigV4Input } from './sigv4.js';

export type RecordingStoreKind = 'none' | 's3';

export interface RecordingStoreConfig {
  kind: RecordingStoreKind;
  s3?: S3RecordingConfig;
}

/** Verilen yapılandırmaya göre kayıt deposunu kurar. kind='none' → kapalı. */
export function createRecordingStore(cfg: RecordingStoreConfig): IRecordingStore {
  switch (cfg.kind) {
    case 's3':
      if (!cfg.s3) throw new Error('RECORDING_STORE=s3 ama S3 yapılandırması eksik.');
      return new S3RecordingStore(cfg.s3);
    case 'none':
      return new NoneRecordingStore();
    default:
      throw new Error(`Bilinmeyen kayıt deposu: ${cfg.kind}`);
  }
}
