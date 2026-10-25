/**
 * AI lead summary
 *
 * Summarizes a lead with Claude through the Anthropic SDK (ai.generateSummary).
 */

import { CLAUDE_MAX_TOKENS, CLAUDE_MODEL, anthropic as claude } from '../client';
import { reportClaudeFailure } from '../failures';

/**
 * Generate lead summary
 * @param lead - Lead data to summarize
 * @returns AI-generated summary
 */
export async function generateLeadSummary(lead: {
  name?: string | null;
  email?: string | null;
  company?: string | null;
  industry?: string | null;
  position?: string | null;
  notes?: string | null;
  status?: string | null;
}): Promise<string> {
  const prompt = `Provide a concise 2-3 sentence summary of this lead:

Name: ${lead.name || 'N/A'}
Company: ${lead.company || 'N/A'}
Industry: ${lead.industry || 'N/A'}
Position: ${lead.position || 'N/A'}
Status: ${lead.status || 'N/A'}
Notes: ${lead.notes || 'N/A'}

Focus on key business value and next steps.`;

  try {
    const message = await claude.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: CLAUDE_MAX_TOKENS,
      output_config: { effort: 'low' },
      messages: [{ role: 'user', content: prompt }],
    });

    // Thinking blocks come before the text, so collect only the text blocks
    const summary = message.content
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('');

    if (!summary.trim()) {
      console.error('Lead summary: no text in the response', message.stop_reason);
      return 'Unable to generate summary';
    }
    if (message.stop_reason === 'max_tokens') {
      console.error('Lead summary: cut off at max_tokens');
    }

    return summary.trim();
  } catch (error) {
    console.error('Error generating lead summary:', error);
    await reportClaudeFailure('lead-summary', error);
    return 'Unable to generate summary';
  }
}
