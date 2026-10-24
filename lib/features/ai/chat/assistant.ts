/**
 * AI lead summary
 *
 * Summarizes a lead with Claude through the Vercel AI SDK (ai.generateSummary).
 */

import { createAnthropic } from '@ai-sdk/anthropic';
import { type LanguageModel, streamText } from 'ai';

// Initialize Anthropic provider
const anthropic = createAnthropic({
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
    const result = await streamText({
      model: anthropic('claude-sonnet-4-20250514') as LanguageModel,
      prompt,
    });

    // Convert stream to text
    let summary = '';
    for await (const textPart of result.textStream) {
      summary += textPart;
    }

    return summary.trim();
  } catch (error) {
    console.error('Error generating lead summary:', error);
    return 'Unable to generate summary';
  }
}
