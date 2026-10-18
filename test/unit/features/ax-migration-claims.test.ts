/**
 * The AX migration site may not assert results it has no records for (#224, #51): a published
 * page is advertising. Restore a claim only together with the figures that back it.
 */
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
    ['ja', [...strings(ja.axSite), ...strings(ja.axDiagnosis)], /大幅に短縮|素早く正確|リスクを解消|高成長を実現|事業変革を実現|短納期|安全かつ短期間/],
    ['en', [...strings(en.axSite), ...strings(en.axDiagnosis)], /greatly shortens|quickly and accurately|remove the (continuity )?risk|high growth|Short delivery/i],
  ])('makes no unbacked claims in %s', (_, texts, claims) => {
    expect(texts.filter((text) => claims.test(text))).toEqual([]);
  });
});
