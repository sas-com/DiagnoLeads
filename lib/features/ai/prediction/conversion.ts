/**
 * Conversion Prediction Service
 * Uses AI to predict lead conversion probability
 */

import { jsonSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/json-schema';
import { CLAUDE_MAX_TOKENS, CLAUDE_MODEL, anthropic } from '../client';
import { reportClaudeFailure } from '../failures';
import type { ContactCompleteness, LeadForClaude } from '../prompt-input';
import { AI_BATCH_MAX } from '../types/schemas';

/** The lead as the prediction reads it: nothing that points at a person (#406) */
export type LeadForPrediction = LeadForClaude;

export interface ConversionPrediction {
  /** Conversion probability (0-100) */
  probability: number;
  /** Confidence level (low, medium, high) */
  confidence: 'low' | 'medium' | 'high';
  /** Predicted days to conversion (null if unlikely) */
  estimatedDaysToConversion: number | null;
  /** Key factors influencing the prediction */
  factors: ConversionFactor[];
  /** Recommended actions to improve conversion */
  recommendations: string[];
  /** Risk factors that may prevent conversion */
  risks: string[];
}

const predictionOutputFormat = jsonSchemaOutputFormat({
  type: 'object',
  properties: {
    probability: { type: 'number', description: 'Conversion probability, 0-100' },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    estimatedDaysToConversion: { type: ['number', 'null'] },
    factors: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          impact: { type: 'string', enum: ['positive', 'negative', 'neutral'] },
          weight: { type: 'number', description: 'Weight, 1-10' },
          description: { type: 'string', description: 'Brief description' },
        },
        required: ['name', 'impact', 'weight', 'description'],
        additionalProperties: false,
      },
    },
    recommendations: { type: 'array', items: { type: 'string' } },
    risks: { type: 'array', items: { type: 'string' } },
  },
  required: [
    'probability',
    'confidence',
    'estimatedDaysToConversion',
    'factors',
    'recommendations',
    'risks',
  ],
  additionalProperties: false,
});

export interface ConversionFactor {
  name: string;
  impact: 'positive' | 'negative' | 'neutral';
  weight: number;
  description: string;
}

/**
 * Predict conversion probability for a single lead
 */
export async function predictConversion(
  lead: LeadForPrediction,
  contact: ContactCompleteness
): Promise<ConversionPrediction> {
  const prompt = buildPredictionPrompt(lead);

  try {
    const message = await anthropic.messages.parse({
      model: CLAUDE_MODEL,
      max_tokens: CLAUDE_MAX_TOKENS,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
      output_config: { effort: 'low', format: predictionOutputFormat },
    });

    if (!message.parsed_output) {
      console.error('Conversion prediction: no structured output', message.stop_reason);
      return generateFallbackPrediction(lead, contact);
    }

    return normalizePrediction(message.parsed_output);
  } catch (error) {
    console.error('Conversion prediction error:', error);
    await reportClaudeFailure('predict-conversion', error);
    // Return a fallback prediction based on simple heuristics
    return generateFallbackPrediction(lead, contact);
  }
}

/**
 * Batch predict conversion for multiple leads
 */
export async function predictConversionBatch(
  leads: Array<{ lead: LeadForPrediction; contact: ContactCompleteness }>
): Promise<Map<string, ConversionPrediction>> {
  const results = new Map<string, ConversionPrediction>();

  // Process in parallel; the router accepts at most one group (AI_BATCH_MAX)
  for (let i = 0; i < leads.length; i += AI_BATCH_MAX) {
    const batch = leads.slice(i, i + AI_BATCH_MAX);
    const predictions = await Promise.all(
      batch.map(({ lead, contact }) => predictConversion(lead, contact))
    );
    batch.forEach(({ lead }, index) => {
      results.set(lead.id, predictions[index]);
    });
  }

  return results;
}

/**
 * Build the prompt for conversion prediction
 */
function buildPredictionPrompt(lead: LeadForPrediction): string {
  const leadAge = Math.floor(
    (Date.now() - new Date(lead.createdAt).getTime()) / (1000 * 60 * 60 * 24)
  );

  return `You are an expert B2B sales analyst. Analyze this lead and predict their conversion probability.

Lead Information:
- Company: ${lead.company || 'Unknown'}
- Current Status: ${lead.status}
- Lead Score: ${lead.score ?? 'Not scored'}
- Source: ${lead.source || 'Unknown'}
- Days Since Creation: ${leadAge}
- Diagnostic Responses: ${JSON.stringify(lead.responses || {}, null, 2)}

Based on this information, predict the conversion: probability (0-100), confidence, estimated days to conversion (or null), the key factors (impact and a 1-10 weight each), recommendations, and risks.

Consider:
1. Lead completeness (company info, diagnostic responses)
2. Engagement signals (responses, score)
3. Time factors (lead age, status progression)
4. Source quality
5. Industry patterns for B2B conversion`;
}

/**
 * Clamp the structured output into the ranges the UI expects
 */
function normalizePrediction(parsed: ConversionPrediction): ConversionPrediction {
  return {
    probability: Math.min(100, Math.max(0, parsed.probability)),
    confidence: parsed.confidence,
    estimatedDaysToConversion: parsed.estimatedDaysToConversion,
    factors: parsed.factors.map((f) => ({
      ...f,
      weight: Math.min(10, Math.max(1, f.weight)),
    })),
    recommendations: parsed.recommendations,
    risks: parsed.risks,
  };
}

/**
 * Generate a fallback prediction based on simple heuristics
 */
function generateFallbackPrediction(
  lead: LeadForPrediction,
  contact: ContactCompleteness
): ConversionPrediction {
  let probability = 30; // Base probability
  const factors: ConversionFactor[] = [];

  // Score factor
  if (lead.score !== null) {
    if (lead.score >= 80) {
      probability += 25;
      factors.push({
        name: 'High Lead Score',
        impact: 'positive',
        weight: 8,
        description: 'Lead has a high engagement score',
      });
    } else if (lead.score >= 50) {
      probability += 10;
      factors.push({
        name: 'Medium Lead Score',
        impact: 'positive',
        weight: 5,
        description: 'Lead has a moderate engagement score',
      });
    }
  }

  // Status factor
  if (lead.status === 'negotiating') {
    probability += 20;
    factors.push({
      name: 'Negotiating Status',
      impact: 'positive',
      weight: 7,
      description: 'Lead is in negotiation with the sales team',
    });
  } else if (lead.status === 'nurturing') {
    probability += 10;
    factors.push({
      name: 'Nurturing Status',
      impact: 'positive',
      weight: 5,
      description: 'Lead is being nurtured',
    });
  }

  // Completeness factor
  const completeness = [contact.hasName, Boolean(lead.company), contact.hasPhone].filter(
    Boolean
  ).length;

  if (completeness >= 2) {
    probability += 10;
    factors.push({
      name: 'Complete Profile',
      impact: 'positive',
      weight: 4,
      description: 'Lead has provided good contact information',
    });
  } else if (completeness === 0) {
    probability -= 10;
    factors.push({
      name: 'Incomplete Profile',
      impact: 'negative',
      weight: 3,
      description: 'Missing key contact information',
    });
  }

  // Source factor
  if (lead.source === 'website') {
    probability += 5;
    factors.push({
      name: 'Website Source',
      impact: 'positive',
      weight: 3,
      description: 'Lead came from direct website engagement',
    });
  }

  // Cap probability
  probability = Math.min(95, Math.max(5, probability));

  // Determine confidence
  const confidence: 'low' | 'medium' | 'high' =
    factors.length >= 3 ? 'high' : factors.length >= 2 ? 'medium' : 'low';

  // Estimate days to conversion
  const estimatedDaysToConversion = probability >= 60 ? Math.round(30 - probability * 0.2) : null;

  // Generate recommendations
  const recommendations: string[] = [];
  if (!contact.hasPhone) {
    recommendations.push('Request phone number for direct contact');
  }
  if (lead.status === 'new') {
    recommendations.push('Initiate first contact within 24 hours');
  }
  if (lead.score === null || lead.score < 50) {
    recommendations.push('Send nurturing content to increase engagement');
  }

  // Identify risks
  const risks: string[] = [];
  if (lead.status === 'new') {
    const leadAge = Math.floor(
      (Date.now() - new Date(lead.createdAt).getTime()) / (1000 * 60 * 60 * 24)
    );
    if (leadAge > 7) {
      risks.push('Lead aging without engagement - risk of going cold');
    }
  }
  if (!lead.company) {
    risks.push('Unknown company - difficult to qualify business fit');
  }

  return {
    probability,
    confidence,
    estimatedDaysToConversion,
    factors,
    recommendations,
    risks,
  };
}
