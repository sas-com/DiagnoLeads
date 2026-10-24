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
  MAX_EMBEDDING_FIELD_CHARS,
  MAX_EMBEDDING_TEXT_CHARS,
  prepareLeadText,
} from '@/lib/features/ai/embeddings/openai';

describe('prepareLeadText', () => {
  it('should combine all lead fields', () => {
    const lead = {
      name: 'John Doe',
      email: 'john@example.com',
      company: 'Acme Corp',
      industry: 'Technology',
      position: 'CEO',
      notes: 'Important client',
    };

    const result = prepareLeadText(lead);

    expect(result).toContain('John Doe');
    expect(result).toContain('john@example.com');
    expect(result).toContain('Acme Corp');
    expect(result).toContain('Technology');
    expect(result).toContain('CEO');
    expect(result).toContain('Important client');
  });

  it('should handle null values', () => {
    const lead = {
      name: 'Jane Smith',
      email: null,
      company: 'Test Inc',
      industry: null,
      position: null,
      notes: null,
    };

    const result = prepareLeadText(lead);

    expect(result).toBe('Jane Smith Test Inc');
  });

  it('should handle undefined values', () => {
    const lead = {
      name: 'Test User',
      company: 'Test Company',
    };

    const result = prepareLeadText(lead);

    expect(result).toBe('Test User Test Company');
  });

  it('should handle empty object', () => {
    const lead = {};

    const result = prepareLeadText(lead);

    expect(result).toBe('');
  });

  it('should handle all null values', () => {
    const lead = {
      name: null,
      email: null,
      company: null,
      industry: null,
      position: null,
      notes: null,
    };

    const result = prepareLeadText(lead);

    expect(result).toBe('');
  });

  it('should preserve order of fields', () => {
    const lead = {
      name: 'First',
      email: 'Second',
      company: 'Third',
      industry: 'Fourth',
      position: 'Fifth',
      notes: 'Sixth',
    };

    const result = prepareLeadText(lead);

    expect(result).toBe('First Second Third Fourth Fifth Sixth');
  });

  it('should handle Japanese text', () => {
    const lead = {
      name: '田中太郎',
      company: '株式会社テスト',
      industry: 'IT業界',
      notes: 'メモ: 重要顧客',
    };

    const result = prepareLeadText(lead);

    expect(result).toContain('田中太郎');
    expect(result).toContain('株式会社テスト');
    expect(result).toContain('IT業界');
    expect(result).toContain('メモ: 重要顧客');
  });

  it('should handle whitespace in values', () => {
    const lead = {
      name: '  John Doe  ',
      company: 'Acme  Corp',
    };

    const result = prepareLeadText(lead);

    // Whitespace is preserved
    expect(result).toContain('  John Doe  ');
  });

  it('should handle special characters', () => {
    const lead = {
      name: "O'Brien & Associates",
      email: 'test+tag@example.com',
      notes: 'Notes with <html> & "quotes"',
    };

    const result = prepareLeadText(lead);

    expect(result).toContain("O'Brien & Associates");
    expect(result).toContain('test+tag@example.com');
    expect(result).toContain('<html>');
  });

  it('should handle empty string values', () => {
    const lead = {
      name: '',
      email: 'test@example.com',
      company: '',
    };

    const result = prepareLeadText(lead);

    // Empty strings are filtered out
    expect(result).toBe('test@example.com');
  });

  it('cuts each field and the whole text, so one embedding has a bounded size (#576)', () => {
    const long = (char: string) => char.repeat(2_000_000);
    const result = prepareLeadText({
      name: long('n'),
      email: 'x@example.com',
      company: long('c'),
      industry: long('i'),
      position: long('p'),
      notes: long('m'),
    });

    expect(result.length).toBe(MAX_EMBEDDING_TEXT_CHARS);
    const [name, email, company] = result.split(' ');
    expect(name).toBe('n'.repeat(MAX_EMBEDDING_FIELD_CHARS));
    expect(email).toBe('x@example.com');
    expect(company).toBe('c'.repeat(MAX_EMBEDDING_FIELD_CHARS));
  });

  it('keeps a short lead as it is, and never cuts inside a surrogate pair', () => {
    expect(prepareLeadText({ name: '山田 太郎', company: '株式会社テスト' })).toBe(
      '山田 太郎 株式会社テスト'
    );

    // An emoji is two UTF-16 code units: the field ends before the one it would split
    const name = `${'a'.repeat(MAX_EMBEDDING_FIELD_CHARS - 1)}😀`;
    expect(prepareLeadText({ name })).toBe('a'.repeat(MAX_EMBEDDING_FIELD_CHARS - 1));
  });
});

describe('generateEmbedding type validation', () => {
  it('should export generateEmbedding function', async () => {
    const { generateEmbedding } = await import('@/lib/features/ai/embeddings/openai');
    expect(typeof generateEmbedding).toBe('function');
  });

  it('should export generateEmbeddingsBatch function', async () => {
    const { generateEmbeddingsBatch } = await import('@/lib/features/ai/embeddings/openai');
    expect(typeof generateEmbeddingsBatch).toBe('function');
  });
});
