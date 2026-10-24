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

/**
 * Score a lead using Claude AI
 * @param lead - Lead information to analyze
 * @returns AI-generated lead score and recommendations
 */
export async function scoreLeadWithAI(lead: {
  name?: string | null;
  email?: string | null;
  company?: string | null;
  industry?: string | null;
  position?: string | null;
  notes?: string | null;
  status?: string | null;
  createdAt?: Date;
}): Promise<LeadScoreResult> {
  try {
    const prompt = `You are an expert B2B sales analyst. Analyze the following lead and provide a comprehensive score.

Lead Information:
- Name: ${lead.name || 'N/A'}
- Email: ${lead.email || 'N/A'}
- Company: ${lead.company || 'N/A'}
- Industry: ${lead.industry || 'N/A'}
- Position: ${lead.position || 'N/A'}
- Status: ${lead.status || 'N/A'}
- Notes: ${lead.notes || 'N/A'}
- Created: ${lead.createdAt ? lead.createdAt.toISOString() : 'N/A'}

Return:
1. score (0-100): Overall lead quality score
2. confidence (low/medium/high): How confident you are in this score
3. reasoning: One or two sentences for the sales rep on why the lead got this score (the conclusion, not your working)
4. recommendedActions: Array of 2-3 specific action items
5. priority (low/medium/high/urgent): Priority level for follow-up

Consider factors like:
- Company size and reputation
- Decision-maker position
- Industry fit
- Lead engagement level
- Timing and urgency signals`;

    const message = await anthropic.messages.parse({
      model: CLAUDE_MODEL,
      max_tokens: CLAUDE_MAX_TOKENS,
      messages: [
        {
          role: 'user',
          content: prompt,
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
  leads: Array<{
    id: string;
    name?: string | null;
    email?: string | null;
    company?: string | null;
    industry?: string | null;
    position?: string | null;
    notes?: string | null;
    status?: string | null;
    createdAt?: Date;
  }>
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
