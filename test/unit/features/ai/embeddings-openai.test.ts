/**
 * OpenAI Embeddings Tests
 *
 * Tests for embedding preparation and helper functions
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock OpenAI
vi.mock('openai', () => ({
  OpenAI: vi.fn().mockImplementation(() => ({
    embeddings: {
      create: vi.fn().mockResolvedValue({
        data: [{ embedding: new Array(1536).fill(0.1) }],
      }),
    },
  })),
}));

import {
  EMBEDDING_MAX_INPUT_TOKENS,
  MAX_EMBEDDING_FIELD_CHARS,
  MAX_EMBEDDING_TEXT_CHARS,
  prepareLeadText,
} from '@/lib/features/ai/embeddings/openai';

describe('prepareLeadText', () => {
  it('should use the company name', () => {
    expect(prepareLeadText({ company: 'Acme Corp' })).toBe('Acme Corp');
  });

  it('should leave out everything that points at a person (#406), whatever the caller passes', () => {
    const lead = {
      name: '田中太郎',
      email: 'tanaka@example.com',
      phone: '03-0000-0000',
      notes: 'メモ: 重要顧客',
      company: '株式会社テスト',
    };

    expect(prepareLeadText(lead)).toBe('株式会社テスト');
  });

  it('should handle null, undefined and empty values', () => {
    expect(prepareLeadText({ company: null })).toBe('');
    expect(prepareLeadText({ company: '' })).toBe('');
    expect(prepareLeadText({})).toBe('');
  });

  it('should keep whitespace and special characters as they are', () => {
    expect(prepareLeadText({ company: "  O'Brien & <Associates>  " })).toBe(
      "  O'Brien & <Associates>  "
    );
  });

  it('cuts the company to the field limit, so one embedding has a bounded size (#576)', () => {
    const result = prepareLeadText({ company: 'c'.repeat(2_000_000) });

    expect(result).toBe('c'.repeat(MAX_EMBEDDING_FIELD_CHARS));
    expect(result.length).toBeLessThanOrEqual(MAX_EMBEDDING_TEXT_CHARS);
  });

  it('keeps a short company name as it is, and never cuts inside a surrogate pair', () => {
    expect(prepareLeadText({ company: '株式会社テスト' })).toBe('株式会社テスト');

    // An emoji is two UTF-16 code units: the field ends before the one it would split
    const company = `${'a'.repeat(MAX_EMBEDDING_FIELD_CHARS - 1)}😀`;
    expect(prepareLeadText({ company })).toBe('a'.repeat(MAX_EMBEDDING_FIELD_CHARS - 1));
  });

  it("keeps the longest lead within the model's input limit, whatever its characters (#598)", () => {
    // The tokenizer (cl100k_base) is a byte-level BPE: never more tokens than UTF-8 bytes. The
    // costliest characters per UTF-16 unit are 3-byte ones (kanji, rare kanji); an emoji is 4
    // bytes for 2 units
    const bytes = (text: string) => new TextEncoder().encode(text).length;
    const filled = (char: string) => {
      const field = char.repeat(MAX_EMBEDDING_FIELD_CHARS);
      return prepareLeadText({ company: field });
    };

    for (const char of ['𠮷', '鬱', '😀', 'a']) {
      const text = filled(char);
      expect(text.length).toBeLessThanOrEqual(MAX_EMBEDDING_TEXT_CHARS);
      expect(bytes(text)).toBeLessThanOrEqual(EMBEDDING_MAX_INPUT_TOKENS);
    }
    expect(bytes(filled('鬱'))).toBe(3 * MAX_EMBEDDING_FIELD_CHARS);
  });
});

describe('generateEmbedding type validation', () => {
  it('should export generateEmbedding function', async () => {
    const { generateEmbedding } = await import('@/lib/features/ai/embeddings/openai');
    expect(typeof generateEmbedding).toBe('function');
  });
});
