// =============================================================================
// brokenPromise.test.ts — kırılan ödeme sözü saf kararı
// =============================================================================
import { describe, it, expect } from 'vitest';
import { decideBrokenPromise, type BrokenPromiseConfig } from '../brokenPromise.js';

const cfg: BrokenPromiseConfig = {
  graceDays: 1,
  maxFollowups: 1,
  followupDelayHours: 2,
};
const NOW = new Date('2026-06-15T12:00:00Z');

describe('decideBrokenPromise', () => {
  it('söz tarihi yoksa kırık sayılmaz', () => {
    const d = decideBrokenPromise({ promisedDate: null, followupsSoFar: 0 }, cfg, NOW);
    expect(d.isBroken).toBe(false);
    expect(d.schedule).toBe(false);
  });

  it('vade + grace henüz geçmediyse kırık değil', () => {
    // Söz dün (14 Haz), grace 1 gün → 15 Haz 12:00 henüz break anına ulaşmadı?
    // breakAt = 14 Haz 12:00 + 1g = 15 Haz 12:00 → now == breakAt → kırık (>=).
    // Bu yüzden henüz geçmemiş örnek: söz bugün (15 Haz), grace 1g → break 16 Haz.
    const d = decideBrokenPromise(
      { promisedDate: new Date('2026-06-15T00:00:00Z'), followupsSoFar: 0 },
      cfg,
      NOW,
    );
    expect(d.isBroken).toBe(false);
    expect(d.reason).toBe('not_yet_due');
  });

  it('vade + grace geçti, takip hakkı var → kırık + planla', () => {
    const d = decideBrokenPromise(
      { promisedDate: new Date('2026-06-10T00:00:00Z'), followupsSoFar: 0 },
      cfg,
      NOW,
    );
    expect(d.isBroken).toBe(true);
    expect(d.schedule).toBe(true);
    expect(d.notBefore).toEqual(new Date('2026-06-15T14:00:00Z')); // now + 2s
  });

  it('takip limiti dolduysa kırık ama yeni arama yok (taciz önleme)', () => {
    const d = decideBrokenPromise(
      { promisedDate: new Date('2026-06-10T00:00:00Z'), followupsSoFar: 1 },
      cfg,
      NOW,
    );
    expect(d.isBroken).toBe(true);
    expect(d.schedule).toBe(false);
    expect(d.reason).toBe('broken_followups_exhausted');
  });
});
