/**
 * The AX migration site may not assert results it has no records for (#224, #51): a published
 * page is advertising. Restore a claim only together with the figures that back it.
 */
import { axMigrationDefinition } from '@/lib/features/diagnostics/ax-migration/definition';
import en from '@/locales/en/common.json';
import ja from '@/locales/ja/common.json';
import { describe, expect, it } from 'vitest';

function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (value && typeof value === 'object') return Object.values(value).flatMap(strings);
  return [];
}

describe('AX migration copy', () => {
  it.each([
    ['ja', [...strings(ja.axSite), ...strings(ja.axAccess), ...strings(ja.axDiagnosis)], /大幅に(短縮|圧縮)|素早く正確|リスクを解消|高成長を実現|事業変革を実現|短納期|安全かつ短期|短期に実現|即応|すぐ対応|安全な移行|混乱を回避|担保/],
    ['en', [...strings(en.axSite), ...strings(en.axAccess), ...strings(en.axDiagnosis)], /greatly (shortens|reduces)|quickly and accurately|remove the (continuity )?risk|eliminat|prevents? misreading|avoids? confusion|achieve high growth|High growth with|Short delivery/i],
  ])('makes no unbacked claims in %s', (_, texts, claims) => {
    expect(texts.filter((text) => claims.test(text))).toEqual([]);
  });

  // The Access page (#296, #158): no promise of uninterrupted work or of safety by moving
  it.each([
    ['ja', strings(ja.axAccess), /止めずに|止まらず|ダウンタイム|安全に|安全です|No\.?1|脱Access|ワンストップ|30秒/],
    ['en', strings(en.axAccess), /without (stopping|interruption|downtime)|zero downtime|makes? it safe|No\.? ?1|one-stop/i],
  ])('keeps the Access page copy within the agreed lines in %s', (_, texts, claims) => {
    expect(texts.filter((text) => claims.test(text))).toEqual([]);
  });

  // The AS/400 and ACOS sections (#311): calm and factual. The platforms are not said to be
  // attacked, and the only date is the one the diagnosis itself gives (phone-line EDI)
  const ediNote = axMigrationDefinition.questions.find((q) => q.id === 'legacy_edi')?.description;
  it.each([
    ['ja', strings(ja.axSite.hosts), /狙われ|攻撃|サイバー|ランサム|脆弱|危険|今すぐ|手遅れ|円/, ediNote?.ja],
    ['en', strings(en.axSite.hosts), /target(ed)? by|attack|cyber|ransom|vulnerab|danger|right now|too late|yen|¥/i, ediNote?.en],
  ])('keeps the host platform copy within the agreed lines in %s', (_, texts, claims, edi) => {
    expect(texts.filter((text) => claims.test(text))).toEqual([]);
    const years = texts.flatMap((text) => text.match(/(?<!\d)(?:19|20)\d{2}(?!\d)/g) ?? []);
    expect(new Set(years)).toEqual(new Set(['2028']));
    expect(edi).toMatch(/2028/);
    for (const text of texts.filter((t) => t.includes('2028'))) {
      expect(text).toContain(edi?.replace(/[。.]$/, ''));
    }
  });
});
