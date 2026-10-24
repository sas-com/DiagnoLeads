import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the AI SDK
vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: vi.fn(() => vi.fn()),
}));

vi.mock('ai', () => ({
  streamText: vi.fn(),
}));

import { streamText } from 'ai';
import { generateLeadSummary } from '@/lib/features/ai/chat/assistant';

describe('ai-chat-assistant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('generateLeadSummary', () => {
    it('should generate summary for a lead', async () => {
      const mockTextStream = {
        [Symbol.asyncIterator]: async function* () {
          yield 'This is ';
          yield 'a lead ';
          yield 'summary.';
        },
      };
      const mockResponse = {
        textStream: mockTextStream,
      };
      (streamText as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      const lead = {
        name: 'John Doe',
        email: 'john@example.com',
        company: 'Tech Inc',
        industry: 'Technology',
        position: 'CEO',
        notes: 'Interested in product',
        status: 'nurturing',
      };

      const result = await generateLeadSummary(lead);

      expect(streamText).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.stringContaining('John Doe'),
        })
      );
      expect(result).toBe('This is a lead summary.');
    });

    it('should handle lead with null fields', async () => {
      const mockTextStream = {
        [Symbol.asyncIterator]: async function* () {
          yield 'Summary for unknown lead.';
        },
      };
      const mockResponse = {
        textStream: mockTextStream,
      };
      (streamText as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      const lead = {
        name: null,
        email: null,
        company: null,
        industry: null,
        position: null,
        notes: null,
        status: null,
      };

      const result = await generateLeadSummary(lead);

      expect(streamText).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.stringContaining('N/A'),
        })
      );
      expect(result).toBe('Summary for unknown lead.');
    });

    it('should handle partial lead data', async () => {
      const mockTextStream = {
        [Symbol.asyncIterator]: async function* () {
          yield 'Partial summary.';
        },
      };
      const mockResponse = {
        textStream: mockTextStream,
      };
      (streamText as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      const lead = {
        name: 'Jane',
        company: 'Acme',
      };

      const result = await generateLeadSummary(lead);

      expect(result).toBe('Partial summary.');
    });

    it('should return error message on API failure', async () => {
      (streamText as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('API Error'));

      const lead = {
        name: 'Test Lead',
      };

      const result = await generateLeadSummary(lead);

      expect(result).toBe('Unable to generate summary');
    });

    it('should trim whitespace from summary', async () => {
      const mockTextStream = {
        [Symbol.asyncIterator]: async function* () {
          yield '  Summary with spaces  ';
        },
      };
      const mockResponse = {
        textStream: mockTextStream,
      };
      (streamText as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      const lead = { name: 'Test' };

      const result = await generateLeadSummary(lead);

      expect(result).toBe('Summary with spaces');
    });
  });
});
