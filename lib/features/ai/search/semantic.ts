/**
 * Semantic Search Service
 *
 * Provides natural language search capabilities for leads using vector embeddings.
 * Allows users to search using phrases like "tech companies in San Francisco"
 * instead of exact keyword matches.
 *
 * Every function takes the caller's database (ctx.db in the AI router), not the global client,
 * so the queries run on the connection the caller was given (RLS will swap it, #590), and reads
 * or writes a lead in the organization named only (#583).
 */

import type { Database } from '@/lib/db';
import { leads } from '@/lib/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { generateEmbedding } from '../embeddings/openai';

/** The database the queries run on: ctx.db in the AI router (or a transaction) */
export type SemanticSearchDatabase = Pick<Database, 'select' | 'execute'>;

/**
 * A lead found by its embedding. Only columns of `leads`: there is no industry column (the
 * AX diagnosis keeps that answer inside `responses`, as an option id of that diagnosis only), so
 * none is returned (#590)
 */
export interface SemanticSearchResult {
  id: string;
  name: string | null;
  email: string | null;
  company: string | null;
  /** Cosine similarity, 1 for the same direction */
  similarity: number;
}

type SimilarityRow = {
  id: string;
  name: string | null;
  email: string | null;
  company: string | null;
  similarity: number;
};

const toResult = ({
  id,
  name,
  email,
  company,
  similarity,
}: SimilarityRow): SemanticSearchResult => ({ id, name, email, company, similarity });

/**
 * An embedding as one pgvector literal ('[0.1,0.2,…]'), to pass as a single parameter cast with
 * ::vector. drizzle's sql turns an array into one parameter per number, a record PostgreSQL
 * cannot cast to vector, so an embedding is never passed as the array itself (#590)
 */
function vectorLiteral(embedding: readonly number[]): string {
  return `[${embedding.join(',')}]`;
}

/**
 * Binds the embedding once, as `q.v`, for a query that compares it several times (a 1536-number
 * literal is about 20 KB). PostgreSQL inlines the CTE, so the plan is the same as with the
 * literal written out each time, and a vector index on the ORDER BY stays usable
 */
function withEmbedding(embedding: readonly number[]) {
  return sql`WITH q AS (SELECT ${vectorLiteral(embedding)}::vector AS v)`;
}

/**
 * Perform semantic search on leads
 * @param db - Database to search with (ctx.db)
 * @param query - Natural language search query
 * @param organizationId - Organization to search within
 * @param limit - Maximum number of results
 * @param minSimilarity - Minimum cosine similarity threshold (0-1)
 * @returns The organization's leads with an embedding, most similar first
 */
export async function semanticSearch({
  db,
  query,
  organizationId,
  limit = 10,
  minSimilarity = 0.7,
}: {
  db: SemanticSearchDatabase;
  query: string;
  organizationId: string;
  limit?: number;
  minSimilarity?: number;
}): Promise<SemanticSearchResult[]> {
  try {
    // Generate embedding for search query
    const queryEmbedding = await generateEmbedding(query);

    // Perform vector similarity search using cosine distance
    // Note: We use 1 - cosine_distance to get similarity (higher is better)
    const rows = await db.execute<SimilarityRow>(sql`
      ${withEmbedding(queryEmbedding)}
      SELECT
        id,
        name,
        email,
        company,
        1 - (embedding <=> q.v) as similarity
      FROM ${leads}, q
      WHERE
        organization_id = ${organizationId}
        AND embedding IS NOT NULL
        AND 1 - (embedding <=> q.v) >= ${minSimilarity}
      ORDER BY embedding <=> q.v
      LIMIT ${limit}
    `);

    return Array.from(rows, toResult);
  } catch (error) {
    console.error('Error performing semantic search:', error);
    throw new Error('Semantic search failed');
  }
}

/**
 * Find similar leads based on a reference lead
 * @param db - Database to read and compare with (ctx.db)
 * @param leadId - Reference lead ID
 * @param organizationId - Organization to search within; the reference lead is read in it only,
 *   so a lead of another organization is never the base of the search (#583)
 * @param limit - Maximum number of results
 * @returns The organization's other leads with an embedding, most similar first
 */
export async function findSimilarLeads({
  db,
  leadId,
  organizationId,
  limit = 5,
}: {
  db: SemanticSearchDatabase;
  leadId: string;
  organizationId: string;
  limit?: number;
}): Promise<SemanticSearchResult[]> {
  try {
    // Get the reference lead's embedding, in the organization searched only
    const [refLead] = await db
      .select({ embedding: leads.embedding })
      .from(leads)
      .where(and(eq(leads.id, leadId), eq(leads.organizationId, organizationId)));

    if (!refLead || !refLead.embedding) {
      throw new Error('Reference lead not found or has no embedding');
    }

    // Find similar leads (excluding the reference lead). The embedding is read back as number[]
    // (the vector column type) and passed again as one pgvector literal
    const rows = await db.execute<SimilarityRow>(sql`
      ${withEmbedding(refLead.embedding)}
      SELECT
        id,
        name,
        email,
        company,
        1 - (embedding <=> q.v) as similarity
      FROM ${leads}, q
      WHERE
        organization_id = ${organizationId}
        AND embedding IS NOT NULL
        AND id != ${leadId}
      ORDER BY embedding <=> q.v
      LIMIT ${limit}
    `);

    return Array.from(rows, toResult);
  } catch (error) {
    console.error('Error finding similar leads:', error);
    throw new Error('Finding similar leads failed');
  }
}

/**
 * Update lead embedding
 * Called by ai.updateEmbedding once the call has been counted (not when a lead is saved).
 * Throws when the embedding or the update fails
 * @param db - Database to write with (ctx.db)
 * @param leadId - Lead to store the embedding on
 * @param organizationId - Organization of the lead; a lead of another organization is not
 *   written, even when the caller has already read the lead in its organization (#583)
 * @param text - Text to embed (bounded by prepareLeadText)
 * @returns Whether the lead was written: false when no lead has this id in the organization
 *   (the caller answers NOT_FOUND rather than success, #590)
 */
export async function updateLeadEmbedding({
  db,
  leadId,
  organizationId,
  text,
}: {
  db: Pick<Database, 'execute'>;
  leadId: string;
  organizationId: string;
  text: string;
}): Promise<boolean> {
  try {
    const embedding = await generateEmbedding(text);
    const embeddingString = vectorLiteral(embedding);

    const updated = await db.execute(sql`
      UPDATE ${leads}
      SET embedding = ${embeddingString}::vector
      WHERE id = ${leadId} AND organization_id = ${organizationId}
      RETURNING id
    `);
    return updated.length > 0;
  } catch (error) {
    // Thrown, not swallowed: the caller has counted a paid call and must not report success
    // when nothing was stored (#598)
    console.error('Error updating lead embedding:', error);
    throw new Error('Updating lead embedding failed');
  }
}
