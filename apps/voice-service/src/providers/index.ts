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
import { DeepgramSTT, deepgramConfigFromEnv } from './stt/deepgram.js';
import { MockTTS } from './tts/mock.js';
import { ElevenLabsTTS } from './tts/elevenlabs.js';
import { MockLLM } from './llm/mock.js';
import { OpenAILLM } from './llm/openai.js';
import { MockOrchestrationPlatform } from './platform/mock.js';
import { RetellOrchestrationPlatform } from './platform/retell.js';
import { VapiOrchestrationPlatform } from './platform/vapi.js';

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
        // Telnyx'in media stream için bağlanacağı BİZİM public WSS base'imiz.
        publicWsBase: requireEnv('TELNYX_MEDIA_WS_URL'),
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
    case 'deepgram':
      return new DeepgramSTT(deepgramConfigFromEnv(requireEnv('DEEPGRAM_API_KEY')));
    default:
      throw new Error(`Unknown STT provider: ${name}`);
  }
}

function pickTTS(name: string): ITTSProvider {
  switch (name) {
    case 'mock':
      return new MockTTS();
    case 'elevenlabs':
      return new ElevenLabsTTS({
        apiKey: requireEnv('ELEVENLABS_API_KEY'),
        voiceId: env.ELEVENLABS_VOICE_ID,
        model: env.ELEVENLABS_MODEL,
        stability: env.ELEVENLABS_STABILITY,
        similarityBoost: env.ELEVENLABS_SIMILARITY,
      });
    default:
      throw new Error(`Unknown TTS provider: ${name}`);
  }
}

function pickLLM(name: string): ILLMProvider {
  switch (name) {
    case 'mock':
      return new MockLLM();
    case 'openai':
      return new OpenAILLM({ apiKey: requireEnv('OPENAI_API_KEY') });
    default:
      throw new Error(`Unknown LLM provider: ${name}`);
  }
}

function pickPlatform(name: string): IOrchestrationPlatform {
  switch (name) {
    case 'mock':
      return new MockOrchestrationPlatform();
    case 'retell':
      return new RetellOrchestrationPlatform({
        apiKey: requireEnv('RETELL_API_KEY'),
        agentId: requireEnv('RETELL_AGENT_ID'),
        fromNumberE164: requireEnv('RETELL_FROM_NUMBER'),
      });
    case 'vapi':
      return new VapiOrchestrationPlatform({
        apiKey: requireEnv('VAPI_API_KEY'),
        assistantId: requireEnv('VAPI_ASSISTANT_ID'),
        phoneNumberId: requireEnv('VAPI_PHONE_NUMBER_ID'),
      });
    default:
      throw new Error(`Unknown orchestration platform: ${name}`);
  }
}
