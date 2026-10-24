/**
 * AI lead summary
 *
 * Summarizes a lead with Claude through the Anthropic SDK (ai.generateSummary).
 */

import Anthropic from '@anthropic-ai/sdk';

// The summary uses the Anthropic SDK directly: `ai` 4.x sends temperature 0 when none is
// given, and Claude Sonnet 5.5 rejects non-default sampling parameters
const anthropicClient = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

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
    const message = await anthropicClient.messages.create({
      model: 'claude-sonnet-5-5',
      max_tokens: 8000,
      output_config: { effort: 'low' },
      messages: [{ role: 'user', content: prompt }],
    });

    // Thinking blocks come before the text, so collect only the text blocks
    const summary = message.content
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('');

    return summary.trim() || 'Unable to generate summary';
  } catch (error) {
    console.error('Error generating lead summary:', error);
    return 'Unable to generate summary';
  }
}
