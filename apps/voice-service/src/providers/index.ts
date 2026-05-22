import type {
  ILLMProvider,
  IOrchestrationPlatform,
  ISTTProvider,
  ITTSProvider,
  ITelephonyProvider,
} from '@voice/shared';
import { env } from '../config.js';
import { MockTelephony } from './telephony/mock.js';
import { TelnyxTelephonyProvider } from './telephony/telnyx.js';
import { MockSTT } from './stt/mock.js';
import { MockTTS } from './tts/mock.js';
import { MockLLM } from './llm/mock.js';
import { MockOrchestrationPlatform } from './platform/mock.js';

export interface ProviderBundle {
  telephony: ITelephonyProvider;
  stt: ISTTProvider;
  tts: ITTSProvider;
  llm: ILLMProvider;
  platform: IOrchestrationPlatform;
}

export function loadProviders(): ProviderBundle {
  return {
    telephony: pickTelephony(env.TELEPHONY_PROVIDER),
    stt: pickSTT(env.STT_PROVIDER),
    tts: pickTTS(env.TTS_PROVIDER),
    llm: pickLLM(env.LLM_PROVIDER),
    platform: pickPlatform(env.ORCHESTRATION_PROVIDER),
  };
}

function pickTelephony(name: string): ITelephonyProvider {
  switch (name) {
    case 'mock':
      return new MockTelephony();
    case 'telnyx':
      return new TelnyxTelephonyProvider({
        apiKey: requireEnv('TELNYX_API_KEY'),
        connectionId: requireEnv('TELNYX_CONNECTION_ID'),
        fromNumberE164: requireEnv('TELNYX_FROM_NUMBER'),
        mediaWsUrl: requireEnv('TELNYX_MEDIA_WS_URL'),
      });
    default:
      throw new Error(`Unknown telephony provider: ${name}`);
  }
}

function requireEnv(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env: ${key} (required for selected provider)`);
  return v;
}

function pickSTT(name: string): ISTTProvider {
  switch (name) {
    case 'mock':
      return new MockSTT();
    default:
      throw new Error(`Unknown STT provider: ${name}`);
  }
}

function pickTTS(name: string): ITTSProvider {
  switch (name) {
    case 'mock':
      return new MockTTS();
    default:
      throw new Error(`Unknown TTS provider: ${name}`);
  }
}

function pickLLM(name: string): ILLMProvider {
  switch (name) {
    case 'mock':
      return new MockLLM();
    default:
      throw new Error(`Unknown LLM provider: ${name}`);
  }
}

function pickPlatform(name: string): IOrchestrationPlatform {
  switch (name) {
    case 'mock':
      return new MockOrchestrationPlatform();
    // 'retell' | 'vapi' → eklenecek
    default:
      throw new Error(`Unknown orchestration platform: ${name}`);
  }
}
