/**
 * AI Features tRPC Router
 *
 * Provides AI-powered functionality for lead management:
 * - Lead scoring with Claude Sonnet 5.5
 * - Semantic search with pgvector
 * - Lead summaries and insights
 *
 * Every procedure that calls Claude (scoring, prediction, summary, alone or in a batch) counts
 * each lead it hands to Claude against AI_CALL_LIMITS (../limits.ts) first, and hands Claude
 * the lead through leadForClaude (../prompt-input.ts), which bounds the size of each call (#405).
 * The procedures that embed a text with OpenAI (semanticSearch, updateEmbedding) count each
 * embedding against EMBEDDING_CALL_LIMITS first, and the text they embed is bounded (#576).
 * findSimilar compares stored embeddings only, without calling OpenAI.
 */

import { leads } from '@/lib/db/schema';
import { emitLeadEvents, leadChangeEvents } from '@/lib/features/webhooks/services/lead-events';
import { organizationProcedure, router } from '@/lib/trpc/init';
import { TRPCError } from '@trpc/server';
import { and, eq, inArray } from 'drizzle-orm';
import { generateLeadSummary } from '../chat/assistant';
import { prepareLeadText } from '../embeddings/openai';
import { consumeAiCalls, consumeEmbeddingCalls } from '../limits';
import { predictConversion, predictConversionBatch } from '../prediction/conversion';
import { leadForClaude } from '../prompt-input';
import { scoreLeadWithAI, scoreLeadsBatch } from '../scoring/claude';
import { findSimilarLeads, semanticSearch, updateLeadEmbedding } from '../search/semantic';
import {
  batchPredictConversionSchema,
  batchScoreLeadsSchema,
  findSimilarLeadsSchema,
  generateSummarySchema,
  predictConversionSchema,
  scoreLeadSchema,
  semanticSearchSchema,
  updateEmbeddingSchema,
} from '../types/schemas';

/**
 * AI features tRPC router
 */
export const aiRouter = router({
  /**
   * Score a single lead using AI
   */
  scoreLead: organizationProcedure.input(scoreLeadSchema).mutation(async ({ ctx, input }) => {
    // Check permission
    if (!ctx.ability.can('update', 'Lead')) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'リードをスコアリングする権限がありません',
      });
    }

    // Get lead
    const lead = await ctx.db.query.leads.findFirst({
      where: and(eq(leads.id, input.leadId), eq(leads.organizationId, input.organizationId)),
    });

    if (!lead) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'リードが見つかりません',
      });
    }

    // Score the lead (a paid Claude call: counted per user and organization)
    await consumeAiCalls(ctx.db, {
      userId: ctx.user.id,
      organizationId: input.organizationId,
      calls: 1,
    });
    const aiScore = await scoreLeadWithAI(leadForClaude(lead));
    if (aiScore.isFallback) {
      // Keep the current score rather than overwriting it with the placeholder
      throw new TRPCError({
        code: 'SERVICE_UNAVAILABLE',
        message: 'AI でリードを評価できませんでした。時間をおいてやり直してください',
      });
    }

    // Update lead with AI score
    const [updated] = await ctx.db
      .update(leads)
      .set({
        score: aiScore.score,
        updatedAt: new Date(),
      })
      .where(and(eq(leads.id, input.leadId), eq(leads.organizationId, input.organizationId)))
      .returning();
    if (updated) {
      emitLeadEvents(input.organizationId, leadChangeEvents(lead, updated), { database: ctx.db });
    }

    return {
      lead: updated,
      aiScore,
    };
  }),

  /**
   * Batch score multiple leads
   */
  batchScoreLeads: organizationProcedure
    .input(batchScoreLeadsSchema)
    .mutation(async ({ ctx, input }) => {
      // Check permission
      if (!ctx.ability.can('update', 'Lead')) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'リードをスコアリングする権限がありません',
        });
      }

      // Get all leads
      const leadsToScore = await ctx.db.query.leads.findMany({
        where: and(
          eq(leads.organizationId, input.organizationId),
          inArray(leads.id, input.leadIds)
        ),
      });

      if (leadsToScore.length === 0) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'リードが見つかりません',
        });
      }

      // Batch score leads: one Claude call per lead found, each counted
      await consumeAiCalls(ctx.db, {
        userId: ctx.user.id,
        organizationId: input.organizationId,
        calls: leadsToScore.length,
      });
      const scoresMap = await scoreLeadsBatch(leadsToScore.map(leadForClaude));

      // Update the leads Claude scored; a fallback keeps the lead's current score
      const scoredLeads = leadsToScore.filter((lead) => !scoresMap.get(lead.id)?.isFallback);
      const failedLeadIds = leadsToScore
        .filter((lead) => scoresMap.get(lead.id)?.isFallback)
        .map((lead) => lead.id);
      if (scoredLeads.length === 0) {
        throw new TRPCError({
          code: 'SERVICE_UNAVAILABLE',
          message: 'AI でリードを評価できませんでした。時間をおいてやり直してください',
        });
      }
      const updatePromises = scoredLeads.map((lead) => {
        const aiScore = scoresMap.get(lead.id);
        if (!aiScore) {
          throw new Error(`Score not found for lead ${lead.id}`);
        }
        return ctx.db
          .update(leads)
          .set({
            score: aiScore.score,
            updatedAt: new Date(),
          })
          .where(and(eq(leads.id, lead.id), eq(leads.organizationId, input.organizationId)))
          .returning();
      });

      const updatedLeads = await Promise.all(updatePromises);
      const before = new Map(leadsToScore.map((lead) => [lead.id, lead]));
      emitLeadEvents(
        input.organizationId,
        updatedLeads.flatMap(([lead]) => {
          const previous = lead ? before.get(lead.id) : undefined;
          return lead && previous ? leadChangeEvents(previous, lead) : [];
        }),
        { database: ctx.db }
      );

      return {
        leads: updatedLeads.map(([lead]) => lead),
        failedLeadIds,
        scores: Array.from(scoresMap.entries()).map(([id, score]) => ({
          leadId: id,
          ...score,
        })),
      };
    }),

  /**
   * Semantic search for leads
   */
  semanticSearch: organizationProcedure
    .input(semanticSearchSchema)
    .query(async ({ ctx, input }) => {
      // Check permission
      if (!ctx.ability.can('read', 'Lead')) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'リードを検索する権限がありません',
        });
      }

      // Embedding the query is a paid OpenAI call: counted per user and organization
      await consumeEmbeddingCalls(ctx.db, {
        userId: ctx.user.id,
        organizationId: input.organizationId,
        calls: 1,
      });
      const results = await semanticSearch(input.query, input.organizationId, {
        limit: input.limit,
        minSimilarity: input.minSimilarity,
      });

      return results;
    }),

  /**
   * Find similar leads
   */
  findSimilar: organizationProcedure.input(findSimilarLeadsSchema).query(async ({ ctx, input }) => {
    // Check permission
    if (!ctx.ability.can('read', 'Lead')) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'リードを閲覧する権限がありません',
      });
    }

    // Verify lead exists
    const lead = await ctx.db.query.leads.findFirst({
      where: and(eq(leads.id, input.leadId), eq(leads.organizationId, input.organizationId)),
    });

    if (!lead) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'リードが見つかりません',
      });
    }

    const similar = await findSimilarLeads(input.leadId, input.organizationId, input.limit);

    return similar;
  }),

  /**
   * Generate lead summary
   */
  generateSummary: organizationProcedure
    .input(generateSummarySchema)
    .query(async ({ ctx, input }) => {
      // Check permission
      if (!ctx.ability.can('read', 'Lead')) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'リードを閲覧する権限がありません',
        });
      }

      // Get lead
      const lead = await ctx.db.query.leads.findFirst({
        where: and(eq(leads.id, input.leadId), eq(leads.organizationId, input.organizationId)),
      });

      if (!lead) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'リードが見つかりません',
        });
      }

      await consumeAiCalls(ctx.db, {
        userId: ctx.user.id,
        organizationId: input.organizationId,
        calls: 1,
      });
      const summary = await generateLeadSummary(leadForClaude(lead));

      return { summary };
    }),

  /**
   * Update lead embedding
   */
  updateEmbedding: organizationProcedure
    .input(updateEmbeddingSchema)
    .mutation(async ({ ctx, input }) => {
      // Check permission
      if (!ctx.ability.can('update', 'Lead')) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'リードを更新する権限がありません',
        });
      }

      // Verify lead exists
      const lead = await ctx.db.query.leads.findFirst({
        where: and(eq(leads.id, input.leadId), eq(leads.organizationId, input.organizationId)),
      });

      if (!lead) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'リードが見つかりません',
        });
      }

      // Prepare text from lead data (bounded), and embed it: a paid OpenAI call, counted
      const text = prepareLeadText(lead);
      await consumeEmbeddingCalls(ctx.db, {
        userId: ctx.user.id,
        organizationId: input.organizationId,
        calls: 1,
      });
      await updateLeadEmbedding(input.leadId, text);

      return { success: true };
    }),

  /**
   * Predict conversion probability for a lead
   */
  predictConversion: organizationProcedure
    .input(predictConversionSchema)
    .query(async ({ ctx, input }) => {
      // Check permission
      if (!ctx.ability.can('read', 'Lead')) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'リードを閲覧する権限がありません',
        });
      }

      // Get lead
      const lead = await ctx.db.query.leads.findFirst({
        where: and(eq(leads.id, input.leadId), eq(leads.organizationId, input.organizationId)),
      });

      if (!lead) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'リードが見つかりません',
        });
      }

      // Predict conversion
      await consumeAiCalls(ctx.db, {
        userId: ctx.user.id,
        organizationId: input.organizationId,
        calls: 1,
      });
      const prediction = await predictConversion(leadForClaude(lead));

      return {
        leadId: lead.id,
        prediction,
      };
    }),

  /**
   * Batch predict conversion for multiple leads
   */
  batchPredictConversion: organizationProcedure
    .input(batchPredictConversionSchema)
    .query(async ({ ctx, input }) => {
      // Check permission
      if (!ctx.ability.can('read', 'Lead')) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'リードを閲覧する権限がありません',
        });
      }

      // Get all leads
      const leadsToPredict = await ctx.db.query.leads.findMany({
        where: and(
          eq(leads.organizationId, input.organizationId),
          inArray(leads.id, input.leadIds)
        ),
      });

      if (leadsToPredict.length === 0) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'リードが見つかりません',
        });
      }

      // Batch predict: one Claude call per lead found, each counted
      await consumeAiCalls(ctx.db, {
        userId: ctx.user.id,
        organizationId: input.organizationId,
        calls: leadsToPredict.length,
      });
      const predictionsMap = await predictConversionBatch(leadsToPredict.map(leadForClaude));

      return {
        predictions: Array.from(predictionsMap.entries()).map(([leadId, prediction]) => ({
          leadId,
          prediction,
        })),
      };
    }),
});
