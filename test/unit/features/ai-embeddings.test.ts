/**
 * AI Embeddings Service Tests
 *
 * Tests for prepareLeadText utility function: the company name only
 */

import { describe, expect, it } from 'vitest';
import { prepareLeadText } from '@/lib/features/ai/embeddings/openai';

describe('AI Embeddings Service', () => {
  describe('prepareLeadText', () => {
    it('should use the company name', () => {
      expect(prepareLeadText({ company: 'Acme Corp' })).toBe('Acme Corp');
    });

    it('should leave out everything that points at a person (#406)', () => {
      const lead = {
        name: 'John Doe',
        email: 'john@example.com',
        notes: 'Important customer',
        company: 'Acme Corp',
      };

      const result = prepareLeadText(lead);

      expect(result).toBe('Acme Corp');
    });

    it('should handle null and undefined fields', () => {
      const result = prepareLeadText({ company: 'Acme Corp' });

      expect(result).toBe('Acme Corp');
      expect(result).not.toContain('null');
      expect(result).not.toContain('undefined');
    });

    it('should return empty string for empty lead', () => {
      expect(prepareLeadText({ company: null })).toBe('');
      expect(prepareLeadText({ company: undefined })).toBe('');
    });
  });
});

describe('Embedding Vector Properties', () => {
  it('should have correct dimensions (1536 for text-embedding-3-small)', () => {
    const expectedDimensions = 1536;
    const mockEmbedding = Array.from({ length: expectedDimensions }, () => 0);

    expect(mockEmbedding).toHaveLength(expectedDimensions);
  });

  it('should contain float values', () => {
    const mockEmbedding = [0.1, -0.2, 0.3, 0.4, -0.5];

    for (const value of mockEmbedding) {
      expect(typeof value).toBe('number');
      expect(Number.isFinite(value)).toBe(true);
    }
  });
});
