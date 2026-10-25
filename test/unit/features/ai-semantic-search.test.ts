/**
 * semantic.ts with a fake database: the queries it builds (organization, parameters, the
 * pgvector literal) and its branches. The queries themselves run on PostgreSQL in
 * test/unit/integration/ai-org-isolation.db.test.ts (#590).
 */
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The functions take the caller's database (#590); the global client is never reached
vi.mock('@/lib/db', () => ({
  db: new Proxy(
    {},
    {
      get: () => {
        throw new Error('the global db was used');
      },
    }
  ),
}));

// Mock embedding generation
vi.mock('@/lib/features/ai/embeddings/openai', () => ({
  generateEmbedding: vi.fn().mockResolvedValue(new Array(1536).fill(0.1)),
}));

import { generateEmbedding } from '@/lib/features/ai/embeddings/openai';
import {
  findSimilarLeads,
  semanticSearch,
  updateLeadEmbedding,
} from '@/lib/features/ai/search/semantic';

/** The caller's database (ctx.db): execute for the raw queries, select … where for the reads */
const db = {
  execute: vi.fn(),
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockResolvedValue([]),
};
const database = db as unknown as Parameters<typeof findSimilarLeads>[0]['db'];

const dialect = new PgDialect();
/** The SQL text and parameters of the first argument of a recorded call */
const queryOf = (fn: unknown, call = 0) =>
  dialect.sqlToQuery((fn as ReturnType<typeof vi.fn>).mock.calls[call][0] as SQL);
const flat = (text: string) => text.replace(/\s+/g, ' ').trim();

describe('semantic-search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('semanticSearch', () => {
    const search = { db: database, organizationId: 'org-1' };

    it('should perform semantic search with default options', async () => {
      const mockResults = [
        { id: 'lead-1', name: 'John Doe', email: 'john@example.com', company: 'Acme', similarity: 0.85 },
        { id: 'lead-2', name: 'Jane Smith', email: 'jane@example.com', company: 'Corp', similarity: 0.75 },
      ];

      db.execute.mockResolvedValue(mockResults);

      const results = await semanticSearch({ ...search, query: 'tech companies' });

      expect(generateEmbedding).toHaveBeenCalledWith('tech companies');
      expect(db.execute).toHaveBeenCalled();
      expect(results).toEqual(mockResults);
    });

    it('returns the columns of leads only, as a plain array (no industry column, #590)', async () => {
      // postgres-js returns the rows as an array with the count and the command on it
      db.execute.mockResolvedValue(
        Object.assign(
          [{ id: 'lead-1', name: null, email: 'a@example.com', company: null, similarity: 0.9 }],
          { count: 1, command: 'SELECT' }
        )
      );

      const results = await semanticSearch({ ...search, query: 'q' });

      expect(results).toEqual([
        { id: 'lead-1', name: null, email: 'a@example.com', company: null, similarity: 0.9 },
      ]);
      expect(Object.keys(results)).toEqual(['0']);
      const text = flat(queryOf(db.execute).sql);
      expect(text).toMatch(
        /^SELECT id, name, email, company, 1 - \(embedding <=> \$1::vector\) as similarity FROM "leads"/
      );
      expect(text).not.toContain('industry');
    });

    it('passes the query embedding as one pgvector literal, in the organization, with the limit and threshold', async () => {
      (generateEmbedding as ReturnType<typeof vi.fn>).mockResolvedValue([0.1, -0.2, 3e-7]);
      db.execute.mockResolvedValue([]);

      await semanticSearch({ ...search, query: 'startups', limit: 5, minSimilarity: 0.8 });

      const { sql: text, params } = queryOf(db.execute);
      const literal = '[0.1,-0.2,3e-7]';
      expect(params).toEqual([literal, 'org-1', literal, 0.8, literal, 5]);
      expect(flat(text)).toContain('WHERE organization_id = $2 AND embedding IS NOT NULL');
      expect(flat(text)).toContain('LIMIT $6');
    });

    it('uses a limit of 10 and a threshold of 0.7 by default', async () => {
      (generateEmbedding as ReturnType<typeof vi.fn>).mockResolvedValue([0.5]);
      db.execute.mockResolvedValue([]);

      await semanticSearch({ ...search, query: 'enterprise software' });

      expect(queryOf(db.execute).params).toEqual(['[0.5]', 'org-1', '[0.5]', 0.7, '[0.5]', 10]);
    });

    it('should handle empty results', async () => {
      db.execute.mockResolvedValue([]);

      const results = await semanticSearch({ ...search, query: 'no matches query' });

      expect(results).toEqual([]);
    });

    it('should throw error on embedding failure', async () => {
      (generateEmbedding as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Embedding API error'));

      await expect(semanticSearch({ ...search, query: 'query' })).rejects.toThrow(
        'Semantic search failed'
      );
      expect(db.execute).not.toHaveBeenCalled();
    });

    it('should throw error on database failure', async () => {
      (generateEmbedding as ReturnType<typeof vi.fn>).mockResolvedValue([0.1]);
      db.execute.mockRejectedValue(new Error('Database error'));

      await expect(semanticSearch({ ...search, query: 'query' })).rejects.toThrow(
        'Semantic search failed'
      );
    });
  });

  describe('findSimilarLeads', () => {
    const similar = { db: database, leadId: 'lead-1', organizationId: 'org-1' };
    // As the vector column type reads it back: number[]
    const reference = { embedding: [0.1, 0.2, 0.3] };

    it('should find similar leads', async () => {
      const mockSimilarLeads = [
        { id: 'lead-2', name: 'Similar Lead', email: 'b@example.com', company: null, similarity: 0.9 },
      ];

      db.where.mockResolvedValue([reference]);
      db.execute.mockResolvedValue(mockSimilarLeads);

      const results = await findSimilarLeads(similar);

      expect(results).toEqual(mockSimilarLeads);
    });

    it('passes the stored embedding as one pgvector literal, not one parameter per number (#590)', async () => {
      db.where.mockResolvedValue([reference]);
      db.execute.mockResolvedValue([]);

      await findSimilarLeads({ ...similar, limit: 10 });

      const { sql: text, params } = queryOf(db.execute);
      expect(params).toEqual(['[0.1,0.2,0.3]', 'org-1', 'lead-1', '[0.1,0.2,0.3]', 10]);
      expect(flat(text)).toMatch(
        /^SELECT id, name, email, company, 1 - \(embedding <=> \$1::vector\) as similarity FROM "leads"/
      );
      expect(flat(text)).toContain(
        'WHERE organization_id = $2 AND embedding IS NOT NULL AND id != $3 ORDER BY embedding <=> $4::vector LIMIT $5'
      );
      expect(text).not.toContain('industry');
    });

    it('uses a limit of 5 by default', async () => {
      db.where.mockResolvedValue([reference]);
      db.execute.mockResolvedValue([]);

      await findSimilarLeads(similar);

      expect(queryOf(db.execute).params.at(-1)).toBe(5);
    });

    it('should throw error when reference lead not found', async () => {
      db.where.mockResolvedValue([]);

      await expect(findSimilarLeads({ ...similar, leadId: 'non-existent' })).rejects.toThrow();
    });

    it('should throw error when reference lead has no embedding', async () => {
      db.where.mockResolvedValue([{ embedding: null }]);

      await expect(
        findSimilarLeads({ ...similar, leadId: 'lead-no-embedding' })
      ).rejects.toThrow();
      expect(db.execute).not.toHaveBeenCalled();
    });

    it('should throw error on database failure', async () => {
      db.where.mockResolvedValue([reference]);
      db.execute.mockRejectedValue(new Error('DB error'));

      await expect(findSimilarLeads(similar)).rejects.toThrow('Finding similar leads failed');
    });

    it('reads the reference lead by its id and the organization searched (#583)', async () => {
      db.where.mockResolvedValue([reference]);
      db.execute.mockResolvedValue([]);

      await findSimilarLeads(similar);

      const read = queryOf(db.where);
      // The parameters are what proves the scope; the rendered SQL is only loosely checked so a
      // drizzle upgrade that changes parentheses or case does not fail this test
      expect(read.sql).toMatch(/"organization_id" = \$2/);
      expect(read.params).toEqual(['lead-1', 'org-1']);
      // The search itself stays in the organization too
      const search = queryOf(db.execute);
      expect(search.sql).toMatch(/organization_id = \$\d+/);
      expect(search.params).toContain('org-1');
    });

    it('never searches when the reference lead is not in the organization (#583)', async () => {
      // A lead of another organization: the read in this organization finds nothing
      db.where.mockResolvedValue([]);

      await expect(
        findSimilarLeads({ ...similar, leadId: 'lead-of-other-org' })
      ).rejects.toThrow('Finding similar leads failed');
      expect(queryOf(db.where).params).toEqual(['lead-of-other-org', 'org-1']);
      expect(db.execute).not.toHaveBeenCalled();
    });
  });

  describe('updateLeadEmbedding', () => {
    const one = { db: database, leadId: 'lead-1', organizationId: 'org-1' };

    it('should call generateEmbedding with text', async () => {
      (generateEmbedding as ReturnType<typeof vi.fn>).mockResolvedValue(new Array(1536).fill(0.1));
      db.execute.mockResolvedValue([{ id: 'lead-1' }]);

      await updateLeadEmbedding({ ...one, text: 'John Doe at Acme Corp' });

      expect(generateEmbedding).toHaveBeenCalledWith('John Doe at Acme Corp');
    });

    it('writes the embedding on the lead with its id and organization only, and reports it (#583, #590)', async () => {
      (generateEmbedding as ReturnType<typeof vi.fn>).mockResolvedValue([0.1, 0.2]);
      db.execute.mockResolvedValue([{ id: 'lead-1' }]);

      await expect(updateLeadEmbedding({ ...one, text: 'text' })).resolves.toBe(true);

      expect(db.execute).toHaveBeenCalledTimes(1);
      const update = queryOf(db.execute);
      expect(flat(update.sql)).toBe(
        'UPDATE "leads" SET embedding = $1::vector WHERE id = $2 AND organization_id = $3 RETURNING id'
      );
      expect(update.params).toEqual(['[0.1,0.2]', 'lead-1', 'org-1']);
    });

    it('reports false when no lead has the id in the organization: nothing was written (#590)', async () => {
      (generateEmbedding as ReturnType<typeof vi.fn>).mockResolvedValue([0.1, 0.2]);
      db.execute.mockResolvedValue([]);

      await expect(
        updateLeadEmbedding({ ...one, leadId: 'lead-of-other-org', text: 'text' })
      ).resolves.toBe(false);
    });

    it('fails when the embedding fails, without writing, and logs the cause (#598)', async () => {
      const cause = new Error('API Error');
      (generateEmbedding as ReturnType<typeof vi.fn>).mockRejectedValue(cause);
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

      await expect(updateLeadEmbedding({ ...one, text: 'text' })).rejects.toThrow(
        'Updating lead embedding failed'
      );
      expect(db.execute).not.toHaveBeenCalled();
      expect(consoleError).toHaveBeenCalledWith('Error updating lead embedding:', cause);
      consoleError.mockRestore();
    });

    it('fails when the update fails (#598)', async () => {
      (generateEmbedding as ReturnType<typeof vi.fn>).mockResolvedValue(new Array(1536).fill(0.1));
      db.execute.mockRejectedValue(new Error('DB Error'));
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

      await expect(updateLeadEmbedding({ ...one, text: 'text' })).rejects.toThrow(
        'Updating lead embedding failed'
      );
      consoleError.mockRestore();
    });
  });

  describe('SemanticSearchResult type', () => {
    it('should have correct structure', () => {
      const result = {
        id: 'lead-1',
        name: 'John Doe',
        email: 'john@example.com',
        company: 'Acme Corp',
        similarity: 0.85,
      };

      expect(result.id).toBeDefined();
      expect(result.similarity).toBeGreaterThanOrEqual(0);
      expect(result.similarity).toBeLessThanOrEqual(1);
    });

    it('should allow null fields', () => {
      const result = {
        id: 'lead-1',
        name: null,
        email: null,
        company: null,
        similarity: 0.7,
      };

      expect(result.name).toBeNull();
      expect(result.email).toBeNull();
    });
  });
});
