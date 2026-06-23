// =============================================================================
// callsCsv.test.ts — arama sonuçları CSV üretimi (saf)
// =============================================================================
import { describe, it, expect } from 'vitest';
import { buildCallsCsv, type CsvCallRow } from '../callsCsv.js';

const row = (over: Partial<CsvCallRow> = {}): CsvCallRow => ({
  fullName: 'Ali Veli',
  phoneE164: '+905551112233',
  amountDueKurus: 123456, // 1234.56 TL
  status: 'COMPLETED',
  outcome: 'PROMISE_TO_PAY',
  promisedAmountKurus: 100000, // 1000.00
  promisedDate: '2026-07-01T00:00:00.000Z',
  durationSec: 47,
  costKurus: 250, // 2.50
  createdAt: '2026-06-23T09:05:00.000Z',
  ...over,
});

describe('buildCallsCsv', () => {
  it('başlık satırı + Türkçe etiketler + TL biçimi', () => {
    const csv = buildCallsCsv([row()]);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe(
      'Borçlu,Telefon,Borç (TL),Durum,Sonuç,Sözlenen Tutar (TL),Sözlenen Tarih,Süre (sn),Maliyet (TL),Oluşturma',
    );
    expect(lines[1]).toBe(
      'Ali Veli,+905551112233,1234.56,Tamamlandı,Ödeme sözü,1000.00,2026-07-01,47,2.50,2026-06-23 09:05',
    );
  });

  it('null sonuç/maliyet/süre boş bırakılır', () => {
    const csv = buildCallsCsv([
      row({ outcome: null, promisedAmountKurus: null, promisedDate: null, durationSec: null, costKurus: null }),
    ]);
    const cols = csv.split('\r\n')[1]!.split(',');
    expect(cols[4]).toBe(''); // sonuç
    expect(cols[5]).toBe(''); // sözlenen tutar
    expect(cols[6]).toBe(''); // sözlenen tarih
    expect(cols[7]).toBe(''); // süre
    expect(cols[8]).toBe(''); // maliyet
  });

  it('virgül/tırnak içeren isim kaçışlanır', () => {
    const csv = buildCallsCsv([row({ fullName: 'Veli, "Patron"' })]);
    expect(csv.split('\r\n')[1]).toContain('"Veli, ""Patron"""');
  });

  it('boş liste: yalnızca başlık', () => {
    expect(buildCallsCsv([]).split('\r\n')).toHaveLength(1);
  });
});
