import { createRecordingStore, type IRecordingStore } from '@voice/shared';
import { env } from '../config.js';

let cached: IRecordingStore | undefined;

/**
 * Env'den kayıt deposunu kurar (singleton). RECORDING_STORE=s3 ise S3 kimlikleri
 * zorunlu; eksikse açık hata. 'none' → kapalı depo (delete no-op).
 */
export function getRecordingStore(): IRecordingStore {
  if (cached) return cached;
  if (env.RECORDING_STORE === 's3') {
    const endpoint = env.RECORDING_S3_ENDPOINT;
    const bucket = env.RECORDING_S3_BUCKET;
    const accessKeyId = env.RECORDING_S3_ACCESS_KEY_ID;
    const secretAccessKey = env.RECORDING_S3_SECRET_ACCESS_KEY;
    if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
      throw new Error(
        'RECORDING_STORE=s3 ama RECORDING_S3_ENDPOINT/BUCKET/ACCESS_KEY_ID/SECRET_ACCESS_KEY eksik.',
      );
    }
    cached = createRecordingStore({
      kind: 's3',
      s3: {
        endpoint,
        bucket,
        region: env.RECORDING_S3_REGION,
        accessKeyId,
        secretAccessKey,
        ...(env.RECORDING_S3_PUBLIC_BASE_URL && { publicBaseUrl: env.RECORDING_S3_PUBLIC_BASE_URL }),
      },
    });
  } else {
    cached = createRecordingStore({ kind: 'none' });
  }
  return cached;
}
