import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { create: mockCreate };
  },
}));

import { generateLeadSummary } from '@/lib/features/ai/chat/assistant';

describe('ai-chat-assistant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('generateLeadSummary', () => {
    const textResponse = (...texts: string[]) => ({
      content: [
        { type: 'thinking', thinking: '', signature: 'sig' },
        ...texts.map((text) => ({ type: 'text', text })),
      ],
    });

    it('should generate summary for a lead', async () => {
      mockCreate.mockResolvedValue(textResponse('This is ', 'a lead summary.'));

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

      const request = mockCreate.mock.calls[0][0];
      expect(request.model).toBe('claude-sonnet-5-5');
      expect(request).not.toHaveProperty('temperature');
      expect(request.messages[0].content).toContain('John Doe');
      expect(result).toBe('This is a lead summary.');
    });

    it('should handle lead with null fields', async () => {
      mockCreate.mockResolvedValue(textResponse('Summary for unknown lead.'));

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

      expect(mockCreate.mock.calls[0][0].messages[0].content).toContain('N/A');
      expect(result).toBe('Summary for unknown lead.');
    });

    it('should handle partial lead data', async () => {
      mockCreate.mockResolvedValue(textResponse('Partial summary.'));

      const result = await generateLeadSummary({ name: 'Jane', company: 'Acme' });

      expect(result).toBe('Partial summary.');
    });

    it('should return error message on API failure', async () => {
      mockCreate.mockRejectedValue(new Error('API Error'));

      const result = await generateLeadSummary({ name: 'Test Lead' });

      expect(result).toBe('Unable to generate summary');
    });

    it('should return error message when there is no text', async () => {
      mockCreate.mockResolvedValue(textResponse());

      const result = await generateLeadSummary({ name: 'Test Lead' });

      expect(result).toBe('Unable to generate summary');
    });

    it('should trim whitespace from summary', async () => {
      mockCreate.mockResolvedValue(textResponse('  Summary with spaces  '));

      const result = await generateLeadSummary({ name: 'Test' });

      expect(result).toBe('Summary with spaces');
    });
  });
});
