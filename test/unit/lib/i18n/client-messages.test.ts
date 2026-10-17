import { AX_CLIENT_MESSAGES, ROOT_CLIENT_MESSAGES, pickMessages } from '@/lib/i18n/client-messages';
import en from '@/locales/en/common.json';
import ja from '@/locales/ja/common.json';
import { describe, expect, it } from 'vitest';

describe('pickMessages', () => {
  const messages = { a: { b: { c: 'x' }, d: 'y' }, e: 'z' };

  it('keeps only the given paths, nested ones with their parents', () => {
    expect(pickMessages(messages, ['a.b', 'e'])).toEqual({ a: { b: { c: 'x' } }, e: 'z' });
  });

  it('merges paths under the same parent and skips missing ones', () => {
    expect(pickMessages(messages, ['a.b', 'a.d', 'nope.x'])).toEqual({
      a: { b: { c: 'x' }, d: 'y' },
    });
  });
});

describe('client message sets', () => {
  it.each([
    ['ja', ja],
    ['en', en],
  ])('exist in %s', (_, catalog) => {
    for (const path of [...ROOT_CLIENT_MESSAGES, ...AX_CLIENT_MESSAGES]) {
      const picked = pickMessages(catalog, [path]);
      expect(Object.keys(picked)).not.toHaveLength(0);
    }
  });

  it('keep the AX site far smaller than the whole catalog', () => {
    const size = (value: unknown) => JSON.stringify(value).length;
    expect(size(pickMessages(ja, AX_CLIENT_MESSAGES))).toBeLessThan(size(ja) / 5);
  });
});
