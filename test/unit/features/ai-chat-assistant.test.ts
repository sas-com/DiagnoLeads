import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { create: mockCreate };
  },
}));

import { generateLeadSummary } from '@/lib/features/ai/chat/assistant';
import type { AiCallScope } from '@/lib/features/ai/usage';

/** The organization the call is made for, logged with the tokens (#47) */
const scope: AiCallScope = { organizationId: 'org-1' };

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

      const result = await generateLeadSummary(lead, scope);

      const request = mockCreate.mock.calls[0][0];
      expect(request.model).toBe('claude-sonnet-5-5');
      expect(request).not.toHaveProperty('temperature');
      // Nothing that points at a person goes to Claude (#406), even if the caller passes it
      const prompt = request.messages[0].content as string;
      expect(prompt).toContain('Tech Inc');
      expect(prompt).not.toContain('John Doe');
      expect(prompt).not.toContain('john@example.com');
      expect(prompt).not.toContain('Interested in product');
      expect(result).toBe('This is a lead summary.');
    });

    it('should handle lead with null fields', async () => {
      mockCreate.mockResolvedValue(textResponse('Summary for unknown lead.'));

      // Every field null, status too (never null in the table)
      const lead = {
        name: null,
        email: null,
        company: null,
        industry: null,
        position: null,
        notes: null,
        status: null,
      };

      // @ts-expect-error leads.status is NOT NULL; the null status is passed on purpose
      const result = await generateLeadSummary(lead, scope);

      // Missing fields are null in the lead's data block (#47)
      expect(mockCreate.mock.calls[0][0].messages[0].content).toContain('"company": null');
      expect(result).toBe('Summary for unknown lead.');
    });

    it('should handle partial lead data', async () => {
      mockCreate.mockResolvedValue(textResponse('Partial summary.'));

      const result = await generateLeadSummary({ company: 'Acme' }, scope);

      expect(result).toBe('Partial summary.');
    });

    it('should return error message on API failure', async () => {
      mockCreate.mockRejectedValue(new Error('API Error'));

      const result = await generateLeadSummary({ company: 'Test Lead' }, scope);

      expect(result).toBe('Unable to generate summary');
    });

    it('should return error message when there is no text', async () => {
      mockCreate.mockResolvedValue(textResponse());

      const result = await generateLeadSummary({ company: 'Test Lead' }, scope);

      expect(result).toBe('Unable to generate summary');
    });

    it('should trim whitespace from summary', async () => {
      mockCreate.mockResolvedValue(textResponse('  Summary with spaces  '));

      const result = await generateLeadSummary({ company: 'Test' }, scope);

      expect(result).toBe('Summary with spaces');
    });
  });
});
