// =============================================================================
// scripts/test-tts.ts — ElevenLabs TTS kalite + gecikme testi
// =============================================================================
// Bir Türkçe tahsilat cümlesini sentezler, PCM 16kHz chunks toplar, WAV
// header ekleyip dosyaya yazar. Çift tıkla → dinle.
//
// Ölçtükleri:
//   - İlk chunk gecikmesi (telefon kalitesinde KRİTİK metrik)
//   - Toplam süre, chunk sayısı, toplam byte
//
// Çalıştırma (repo kökünden):
//   pnpm --filter @voice/voice-service tts:test
// =============================================================================

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ElevenLabsTTS } from '../src/providers/tts/elevenlabs.js';

function ensureKey(): string {
  const k = process.env.ELEVENLABS_API_KEY;
  if (!k) {
    console.error('ELEVENLABS_API_KEY eksik. node --env-file=.env ... ile çalıştırın.');
    process.exit(1);
  }
  return k;
}

// 16-bit mono PCM için WAV header (44 byte).
function wavHeader(sampleRate: number, dataBytes: number): Buffer {
  const buf = Buffer.alloc(44);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);     // fmt chunk size
  buf.writeUInt16LE(1, 20);      // PCM
  buf.writeUInt16LE(1, 22);      // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); // byte rate (16-bit mono)
  buf.writeUInt16LE(2, 32);      // block align
  buf.writeUInt16LE(16, 34);     // bits per sample
  buf.write('data', 36);
  buf.writeUInt32LE(dataBytes, 40);
  return buf;
}

const SAMPLES: { label: string; text: string }[] = [
  {
    label: 'opening',
    text:
      'Merhaba, ben Tahsilat Asistanı. Görüşmemiz kalite ve denetim amacıyla ' +
      'kaydedilebilir. Ayşe Hanım ile mi görüşüyorum?',
  },
  {
    label: 'remind',
    text:
      'Vadesi geçmiş bin iki yüz elli liralık borcunuz bulunuyor. ' +
      'Bu hafta içinde ödeyebilir misiniz?',
  },
  {
    label: 'confirm',
    text: 'Yarın bin iki yüz elli lirayı yatıracağınızı kaydettim. Teyit ediyor musunuz?',
  },
];

async function main() {
  const tts = new ElevenLabsTTS({
    apiKey: ensureKey(),
    voiceId: process.env.ELEVENLABS_VOICE_ID ?? '21m00Tcm4TlvDq8ikWAM',
    model: process.env.ELEVENLABS_MODEL ?? 'eleven_turbo_v2_5',
    stability: Number(process.env.ELEVENLABS_STABILITY ?? 0.5),
    similarityBoost: Number(process.env.ELEVENLABS_SIMILARITY ?? 0.75),
  });

  const sampleRate = 16000;
  console.log(`Model: ${process.env.ELEVENLABS_MODEL ?? 'eleven_turbo_v2_5'}`);
  console.log(`Voice: ${process.env.ELEVENLABS_VOICE_ID ?? '(default)'}`);
  console.log(`Format: PCM ${sampleRate}Hz mono`);
  console.log('='.repeat(72));

  for (const sample of SAMPLES) {
    const t0 = Date.now();
    let firstChunkAt = 0;
    const chunks: Buffer[] = [];

    for await (const chunk of tts.synthesizeStream(sample.text, {
      voice: 'tr-default',
      sampleRate,
      language: 'tr-TR',
    })) {
      if (firstChunkAt === 0) firstChunkAt = Date.now() - t0;
      chunks.push(Buffer.from(chunk.data));
    }

    const total = Buffer.concat(chunks);
    const totalMs = Date.now() - t0;
    const audioDurationMs = Math.round((total.byteLength / (sampleRate * 2)) * 1000);

    const outPath = resolve(process.cwd(), `tts-${sample.label}.wav`);
    writeFileSync(outPath, Buffer.concat([wavHeader(sampleRate, total.byteLength), total]));

    console.log(`\n[${sample.label}] "${sample.text.slice(0, 60)}..."`);
    console.log(`  İlk chunk    : ${firstChunkAt}ms  ← KPI`);
    console.log(`  Toplam       : ${totalMs}ms (${chunks.length} chunk, ${total.byteLength}B)`);
    console.log(`  Ses süresi   : ~${audioDurationMs}ms`);
    console.log(`  Dosya        : ${outPath}`);
  }

  console.log('\n' + '='.repeat(72));
  console.log('Bitti. .wav dosyalarını oynat: Türkçe ton ve telaffuz nasıl?');
  console.log('Voice değiştirmek için: ELEVENLABS_VOICE_ID=<id> .env\'de güncelle.');
}

main().catch((err) => {
  console.error('HATA:', err);
  process.exit(1);
});
