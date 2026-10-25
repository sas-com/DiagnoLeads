/**
 * AI Lead Scoring Service using Claude Sonnet 5.5
 *
 * Analyzes leads and provides intelligent scoring based on:
 * - Company size and industry
 * - Lead activity and engagement
 * - Potential value indicators
 */

import { jsonSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/json-schema';
import { z } from 'zod';
import { CLAUDE_MAX_TOKENS, CLAUDE_MODEL, anthropic } from '../client';
import { reportClaudeFailure } from '../failures';
import type { LeadForClaude } from '../prompt-input';
import { LEAD_DATA_TAG, UNTRUSTED_LEAD_DATA_POLICY, leadDataBlock } from '../prompt-safety';
import { AI_BATCH_MAX } from '../types/schemas';

// Lead score response schema
const LeadScoreSchema = z.object({
  score: z.number().min(0).max(100).describe('Lead score from 0-100'),
  confidence: z.enum(['low', 'medium', 'high']).describe('Confidence level'),
  reasoning: z.string().describe('One or two sentences explaining the score for the sales rep'),
  recommendedActions: z.array(z.string()).describe('Suggested next steps'),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).describe('Priority level'),
});

export type LeadScore = z.infer<typeof LeadScoreSchema>;

/** `isFallback` marks the placeholder returned when Claude could not score the lead; never store it */
export type LeadScoreResult = LeadScore & { isFallback: boolean };

// The same shape for Claude's structured output. Ranges stay in the descriptions;
// LeadScoreSchema enforces them on the result.
const leadScoreOutputFormat = jsonSchemaOutputFormat({
  type: 'object',
  properties: {
    score: { type: 'number', description: 'Lead score from 0-100' },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    reasoning: {
      type: 'string',
      description: 'One or two sentences explaining the score for the sales rep',
    },
    recommendedActions: { type: 'array', items: { type: 'string' } },
    priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
  },
  required: ['score', 'confidence', 'reasoning', 'recommendedActions', 'priority'],
  additionalProperties: false,
});

/** The lead as the scoring reads it: nothing that points at a person (#406) */
type LeadForScoring = Partial<Pick<LeadForClaude, 'id' | 'company' | 'status' | 'createdAt'>>;

const SCORING_SYSTEM_PROMPT = `You are an expert B2B sales analyst. You score leads for the sales team.

${UNTRUSTED_LEAD_DATA_POLICY}`;

/**
 * The scoring request: the lead's fields only inside the <lead_data> block (untrusted, from
 * public forms), the task after it (#47)
 */
function buildScoringPrompt(lead: LeadForScoring): string {
  const data = leadDataBlock(
    {
      company: lead.company || null,
      status: lead.status || null,
      createdAt: lead.createdAt ? lead.createdAt.toISOString() : null,
    },
    { where: 'score-lead', leadId: lead.id }
  );

  return `${data}

Analyze the lead in <${LEAD_DATA_TAG}> and provide a comprehensive score.

Return:
1. score (0-100): Overall lead quality score
2. confidence (low/medium/high): How confident you are in this score
3. reasoning: One or two sentences for the sales rep on why the lead got this score (the conclusion, not your working)
4. recommendedActions: Array of 2-3 specific action items
5. priority (low/medium/high/urgent): Priority level for follow-up

Consider factors like:
- Company size and reputation
- Industry fit
- Lead engagement level
- Timing and urgency signals`;
}

/**
 * Score a lead using Claude AI
 * @param lead - Lead information to analyze (its id is only logged, with the fields that look
 *   like a prompt injection)
 * @returns AI-generated lead score and recommendations
 */
export async function scoreLeadWithAI(lead: LeadForScoring): Promise<LeadScoreResult> {
  try {
    const message = await anthropic.messages.parse({
      model: CLAUDE_MODEL,
      max_tokens: CLAUDE_MAX_TOKENS,
      system: SCORING_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: buildScoringPrompt(lead),
        },
      ],
      output_config: { effort: 'low', format: leadScoreOutputFormat },
    });

    if (!message.parsed_output) {
      throw new Error(`No structured output from Claude (stop_reason: ${message.stop_reason})`);
    }

    return { ...LeadScoreSchema.parse(message.parsed_output), isFallback: false };
  } catch (error) {
    console.error('Error scoring lead with AI:', error);
    await reportClaudeFailure('score-lead', error);

    // Return fallback score
    return {
      score: 50,
      confidence: 'low',
      reasoning: 'Unable to analyze lead due to an error',
      recommendedActions: ['Review lead information', 'Follow up manually'],
      priority: 'medium',
      isFallback: true,
    };
  }
}

/**
 * Batch score multiple leads
 * @param leads - Array of leads to score
 * @returns Array of scores
 */
export async function scoreLeadsBatch(
  leads: Array<LeadForScoring & { id: string }>
): Promise<Map<string, LeadScoreResult>> {
  const scores = new Map<string, LeadScoreResult>();

  // Process leads in parallel; the router accepts at most one group (AI_BATCH_MAX)
  for (let i = 0; i < leads.length; i += AI_BATCH_MAX) {
    const batch = leads.slice(i, i + AI_BATCH_MAX);
    const results = await Promise.all(
      batch.map(async (lead) => ({
        id: lead.id,
        score: await scoreLeadWithAI(lead),
      }))
    );

    for (const result of results) {
      scores.set(result.id, result.score);
    }
  }

  return scores;
}
