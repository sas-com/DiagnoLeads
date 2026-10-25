import { clipText, hasLoneSurrogate, toWellFormed } from '@/lib/utils/clip-text';
import { describe, expect, it } from 'vitest';

describe('clipText (#754)', () => {
  it('keeps at most max UTF-16 units and never cuts a character in half', () => {
    expect(clipText('abcdef', 3)).toBe('abc');
    expect(clipText(`${'a'.repeat(199)}😀`, 200)).toBe('a'.repeat(199));
    expect(clipText(`${'a'.repeat(198)}😀`, 200)).toBe(`${'a'.repeat(198)}😀`);
    expect(clipText('😀😀', 3)).toBe('😀');
    expect(clipText('', 5)).toBe('');
  });
});

describe('hasLoneSurrogate / toWellFormed (#754)', () => {
  it.each([
    ['a lone high surrogate', 'a\ud800b', 'a\ufffdb'],
    ['a lone high surrogate at the end', 'a\ud83d', 'a\ufffd'],
    ['a lone low surrogate', '\udc00a', '\ufffda'],
    ['two highs in a row', '\ud800\ud800', '\ufffd\ufffd'],
  ])('finds and replaces %s', (_, value, fixed) => {
    expect(hasLoneSurrogate(value)).toBe(true);
    expect(toWellFormed(value)).toBe(fixed);
    expect(hasLoneSurrogate(toWellFormed(value))).toBe(false);
  });

  it('leaves well-formed text, emoji included, as it is', () => {
    for (const value of ['', 'plain', '日本語', '😀 and 👨‍👩‍👧', 'U+FFFD \ufffd']) {
      expect(hasLoneSurrogate(value)).toBe(false);
      expect(toWellFormed(value)).toBe(value);
    }
  });
});
