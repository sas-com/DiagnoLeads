/**
 * AI Features Entry Point
 *
 * Centralizes all AI-powered features for DiagnoLeads:
 * - Lead scoring with Claude AI
 * - Semantic search with OpenAI embeddings
 * - Lead insights and summaries
 */

// Export embeddings
export { generateEmbedding, prepareLeadText } from './embeddings/openai';

// Export scoring
export { scoreLeadWithAI, scoreLeadsBatch, type LeadScore } from './scoring/claude';

// Export search
export {
  semanticSearch,
  findSimilarLeads,
  updateLeadEmbedding,
  type SemanticSearchResult,
} from './search/semantic';

// Export summaries
export { generateLeadSummary } from './chat/assistant';

// Export types and schemas
export type {
  ScoreLeadInput,
  SemanticSearchInput,
  FindSimilarLeadsInput,
  GenerateSummaryInput,
  UpdateEmbeddingInput,
  BatchScoreLeadsInput,
} from './types/schemas';

// Export tRPC router
export { aiRouter } from './api/router';
