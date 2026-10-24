/**
 * AI Chat Assistant
 *
 * Streaming chat interface using Vercel AI SDK, plus the lead summary on the Anthropic SDK.
 * The chat does not work on Claude Sonnet 5.5 (`ai` 4.x sends temperature 0, which it
 * rejects) and is to be removed in #432.
 */

import { createAnthropic } from '@ai-sdk/anthropic';
import { type LanguageModel, streamText } from 'ai';
import { CLAUDE_MAX_TOKENS, CLAUDE_MODEL, anthropic as claude } from '../client';

// Initialize Anthropic provider
const anthropic = createAnthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Generate streaming chat response
 * @param messages - Conversation history
 * @param context - Additional context (lead data, org info, etc.)
 * @returns Streaming text response
 */
export async function generateChatResponse(
  messages: ChatMessage[],
  context?: {
    organizationName?: string;
    recentLeads?: Array<{
      name?: string | null;
      company?: string | null;
      status?: string | null;
    }>;
  }
) {
  // Build system prompt with context
  const systemPrompt = `You are DiagnoLeads AI Assistant, a helpful AI that assists with B2B lead management.

You can help users with:
- Analyzing lead data and providing insights
- Suggesting follow-up actions
- Answering questions about leads
- Providing sales recommendations

${context?.organizationName ? `Organization: ${context.organizationName}` : ''}

${
  context?.recentLeads && context.recentLeads.length > 0
    ? `
Recent Leads:
${context.recentLeads.map((lead, i) => `${i + 1}. ${lead.name || 'Unknown'} from ${lead.company || 'Unknown Company'} (${lead.status || 'new'})`).join('\n')}
`
    : ''
}

Be concise, helpful, and professional. Focus on actionable insights.`;

  try {
    const result = await streamText({
      model: anthropic('claude-sonnet-5-5') as LanguageModel,
      system: systemPrompt,
      messages: messages.map((msg) => ({
        role: msg.role,
        content: msg.content,
      })),
    });

    return result.toTextStreamResponse();
  } catch (error) {
    console.error('Error generating chat response:', error);
    throw new Error('Failed to generate chat response');
  }
}

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
    return 'Unable to generate summary';
  }
}
