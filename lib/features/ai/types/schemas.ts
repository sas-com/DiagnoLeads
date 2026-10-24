import { z } from 'zod';

/**
 * Score lead with AI schema
 */
export const scoreLeadSchema = z.object({
  organizationId: z.string().uuid(),
  leadId: z.string().uuid(),
});
export type ScoreLeadInput = z.infer<typeof scoreLeadSchema>;

/**
 * Longest search query: it is embedded (a paid OpenAI call, counted as one) as it is (#576)
 */
export const MAX_SEMANTIC_SEARCH_QUERY_CHARS = 500;

/**
 * Semantic search schema
 */
export const semanticSearchSchema = z.object({
  organizationId: z.string().uuid(),
  query: z
    .string()
    .min(1, '検索クエリを入力してください')
    .max(
      MAX_SEMANTIC_SEARCH_QUERY_CHARS,
      `検索クエリは${MAX_SEMANTIC_SEARCH_QUERY_CHARS}文字以内で入力してください`
    ),
  limit: z.number().int().min(1).max(50).default(10),
  minSimilarity: z.number().min(0).max(1).default(0.7),
});
export type SemanticSearchInput = z.infer<typeof semanticSearchSchema>;

/**
 * Find similar leads schema
 */
export const findSimilarLeadsSchema = z.object({
  organizationId: z.string().uuid(),
  leadId: z.string().uuid(),
  limit: z.number().int().min(1).max(20).default(5),
});
export type FindSimilarLeadsInput = z.infer<typeof findSimilarLeadsSchema>;

/**
 * Generate lead summary schema
 */
export const generateSummarySchema = z.object({
  organizationId: z.string().uuid(),
  leadId: z.string().uuid(),
});
export type GenerateSummaryInput = z.infer<typeof generateSummarySchema>;

/**
 * Update lead embedding schema
 */
export const updateEmbeddingSchema = z.object({
  organizationId: z.string().uuid(),
  leadId: z.string().uuid(),
});
export type UpdateEmbeddingInput = z.infer<typeof updateEmbeddingSchema>;

/**
 * Leads per batch call. They go to Claude in parallel, so one batch takes about as long as one
 * call and stays inside Vercel's 30-second function limit (#534)
 */
export const AI_BATCH_MAX = 5;

/**
 * Batch score leads schema
 */
export const batchScoreLeadsSchema = z.object({
  organizationId: z.string().uuid(),
  leadIds: z.array(z.string().uuid()).min(1).max(AI_BATCH_MAX),
});
export type BatchScoreLeadsInput = z.infer<typeof batchScoreLeadsSchema>;

/**
 * Predict conversion schema
 */
export const predictConversionSchema = z.object({
  organizationId: z.string().uuid(),
  leadId: z.string().uuid(),
});
export type PredictConversionInput = z.infer<typeof predictConversionSchema>;

/**
 * Batch predict conversion schema
 */
export const batchPredictConversionSchema = z.object({
  organizationId: z.string().uuid(),
  leadIds: z.array(z.string().uuid()).min(1).max(AI_BATCH_MAX),
});
export type BatchPredictConversionInput = z.infer<typeof batchPredictConversionSchema>;
