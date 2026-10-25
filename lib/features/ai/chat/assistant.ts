/**
 * AI lead summary
 *
 * Summarizes a lead with Claude through the Anthropic SDK (ai.generateSummary).
 */

import { CLAUDE_MAX_TOKENS, CLAUDE_MODEL, anthropic as claude } from '../client';
import { reportClaudeFailure } from '../failures';
import type { LeadForClaude } from '../prompt-input';
import { LEAD_DATA_TAG, UNTRUSTED_LEAD_DATA_POLICY, leadDataBlock } from '../prompt-safety';
import { type AiCallScope, logAiUsage } from '../usage';

const SUMMARY_SYSTEM_PROMPT = `You are an expert B2B sales analyst. You summarize leads for the sales team.

${UNTRUSTED_LEAD_DATA_POLICY}`;

/**
 * Generate lead summary
 * @param lead - Lead data to summarize (its id is only logged, with the fields that look like a
 *   prompt injection)
 * @param scope - The organization the call is made for, logged with the tokens used (#47)
 * @returns AI-generated summary
 */
export async function generateLeadSummary(
  lead: Partial<Pick<LeadForClaude, 'id' | 'company' | 'status'>>,
  scope: AiCallScope
): Promise<string> {
  // The lead's fields only inside the <lead_data> block (untrusted, from public forms), the
  // task after it (#47)
  const data = leadDataBlock(
    { company: lead.company || null, status: lead.status || null },
    { where: 'lead-summary', leadId: lead.id }
  );
  const prompt = `${data}

Provide a concise 2-3 sentence summary of the lead in <${LEAD_DATA_TAG}>.

Focus on key business value and next steps.`;

  try {
    const startedAt = performance.now();
    const message = await claude.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: CLAUDE_MAX_TOKENS,
      output_config: { effort: 'low' },
      system: SUMMARY_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    });
    logAiUsage({ operation: 'lead-summary', ...scope, model: CLAUDE_MODEL, startedAt }, message);

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
