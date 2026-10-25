/**
 * OpenAI embeddings (lib/features/ai/embeddings/openai.ts) with the SDK replaced (#29): the
 * request sent, the vectors returned, the client made once, and the errors when the call fails
 * or the API key is missing. prepareLeadText is tested in embeddings-openai.test.ts.
 */
import type { EmbeddingCall } from '@/lib/features/ai/embeddings/openai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const openai = vi.hoisted(() => ({
  create: vi.fn(),
  clients: [] as { apiKey?: string; timeout?: number; maxRetries?: number }[],
}));

vi.mock('openai', () => ({
  OpenAI: class {
    embeddings = { create: openai.create };
    constructor(options: { apiKey?: string; timeout?: number; maxRetries?: number }) {
      openai.clients.push(options);
    }
  },
}));

/** A fresh copy of the module, so the lazily made client starts empty */
async function loadModule() {
  vi.resetModules();
  return import('@/lib/features/ai/embeddings/openai');
}

const vector = (seed: number) => Array.from({ length: 4 }, (_, i) => seed + i / 10);

/** What the embedding is for and the organization, logged with the tokens (#47) */
const call: EmbeddingCall = { operation: 'embed-search-query', organizationId: 'org-1' };

describe('OpenAI embeddings', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    openai.create.mockReset();
    openai.clients.length = 0;
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    consoleError.mockRestore();
    vi.unstubAllEnvs();
  });

  describe('generateEmbedding', () => {
    it('asks text-embedding-3-small for float vectors and returns the first one', async () => {
      const { generateEmbedding } = await loadModule();
      openai.create.mockResolvedValue({ data: [{ embedding: vector(1) }] });

      expect(await generateEmbedding('製造業 基幹システム 移行', call)).toEqual(vector(1));
      expect(openai.create).toHaveBeenCalledWith({
        model: 'text-embedding-3-small',
        input: '製造業 基幹システム 移行',
        encoding_format: 'float',
      });
    });

    it('makes the client once, with the API key from the environment', async () => {
      vi.stubEnv('OPENAI_API_KEY', 'sk-test-embeddings');
      const { generateEmbedding } = await loadModule();
      openai.create.mockResolvedValue({ data: [{ embedding: vector(1) }] });

      await generateEmbedding('a', call);
      await generateEmbedding('b', call);
      await generateEmbedding('c', call);

      // One 20-second attempt, no retries: the one call counted is one request, within the
      // 30 seconds of a Vercel function (as the Claude client)
      expect(openai.clients).toEqual([
        { apiKey: 'sk-test-embeddings', timeout: 20_000, maxRetries: 0 },
      ]);
      expect(openai.create).toHaveBeenCalledTimes(3);
    });

    it('fails with a fixed message when the call fails, and logs the cause', async () => {
      const { generateEmbedding } = await loadModule();
      const cause = new Error('429 Rate limit reached');
      openai.create.mockRejectedValue(cause);

      await expect(generateEmbedding('a', call)).rejects.toThrow('Failed to generate embedding');
      expect(consoleError).toHaveBeenCalledWith('Error generating embedding:', cause);
    });

    it('fails without calling OpenAI when the API key is not set', async () => {
      vi.stubEnv('OPENAI_API_KEY', '');
      const { generateEmbedding } = await loadModule();

      await expect(generateEmbedding('a', call)).rejects.toThrow('Failed to generate embedding');
      expect(openai.clients).toHaveLength(0);
      expect(openai.create).not.toHaveBeenCalled();
      expect(consoleError).toHaveBeenCalledWith(
        'Error generating embedding:',
        expect.objectContaining({ message: 'OPENAI_API_KEY environment variable is not set' })
      );
    });
  });
});
