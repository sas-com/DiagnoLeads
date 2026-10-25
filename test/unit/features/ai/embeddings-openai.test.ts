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
  it('should combine the company, industry and position in that order', () => {
    const lead = { company: 'Acme Corp', industry: 'Technology', position: 'CEO' };

    expect(prepareLeadText(lead)).toBe('Acme Corp Technology CEO');
  });

  it('should leave out everything that points at a person (#406)', () => {
    const lead = {
      name: '田中太郎',
      email: 'tanaka@example.com',
      notes: 'メモ: 重要顧客',
      company: '株式会社テスト',
      industry: 'IT業界',
    };

    const result = prepareLeadText(lead);

    expect(result).toBe('株式会社テスト IT業界');
  });

  it('should handle null, undefined and empty values', () => {
    expect(prepareLeadText({ company: 'Test Inc', industry: null, position: undefined })).toBe(
      'Test Inc'
    );
    expect(prepareLeadText({ company: '', industry: 'IT' })).toBe('IT');
    expect(prepareLeadText({})).toBe('');
    expect(prepareLeadText({ company: null, industry: null, position: null })).toBe('');
  });

  it('should keep whitespace and special characters as they are', () => {
    expect(prepareLeadText({ company: "  O'Brien & <Associates>  " })).toBe(
      "  O'Brien & <Associates>  "
    );
  });

  it('cuts each field and the whole text, so one embedding has a bounded size (#576)', () => {
    const long = (char: string) => char.repeat(2_000_000);
    const result = prepareLeadText({ company: long('c'), industry: long('i'), position: long('p') });

    expect(result.length).toBe(MAX_EMBEDDING_TEXT_CHARS);
    const [company, industry, ...rest] = result.split(' ');
    expect(company).toBe('c'.repeat(MAX_EMBEDDING_FIELD_CHARS));
    // The whole is cut inside the industry; the position is left out
    expect(industry).toBe('i'.repeat(MAX_EMBEDDING_TEXT_CHARS - MAX_EMBEDDING_FIELD_CHARS - 1));
    expect(rest).toEqual([]);
  });

  it('keeps a short lead as it is, and never cuts inside a surrogate pair', () => {
    expect(prepareLeadText({ company: '株式会社テスト', industry: '製造業' })).toBe(
      '株式会社テスト 製造業'
    );

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
      return prepareLeadText({ company: field, industry: field, position: field });
    };

    for (const char of ['𠮷', '鬱', '😀', 'a']) {
      const text = filled(char);
      expect(text.length).toBeLessThanOrEqual(MAX_EMBEDDING_TEXT_CHARS);
      expect(bytes(text)).toBeLessThanOrEqual(EMBEDDING_MAX_INPUT_TOKENS);
    }
    expect(bytes(filled('鬱'))).toBe(3 * MAX_EMBEDDING_TEXT_CHARS - 2);
  });
});

describe('generateEmbedding type validation', () => {
  it('should export generateEmbedding function', async () => {
    const { generateEmbedding } = await import('@/lib/features/ai/embeddings/openai');
    expect(typeof generateEmbedding).toBe('function');
  });
});
