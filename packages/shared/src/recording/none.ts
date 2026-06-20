import type { IRecordingStore } from '../providers.js';

/**
 * Kayıt deposu KAPALI. Faz 1'de kayıt platformda; Faz 2'de işletme kayıt
 * saklamıyorsa (KVKK güvenli varsayılan) bu kullanılır. put() asla çağrılmamalı
 * (rıza yoksa kayıt yüklenmez); savunma olarak fırlatır. delete() no-op.
 */
export class NoneRecordingStore implements IRecordingStore {
  readonly name = 'none';

  put(): Promise<string> {
    return Promise.reject(
      new Error('Kayıt deposu kapalı (RECORDING_STORE=none); put çağrılmamalı.'),
    );
  }

  delete(): Promise<void> {
    return Promise.resolve();
  }
}
