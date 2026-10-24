import { TRPCError } from '@trpc/server';
import {
  type RateLimitDatabase,
  type RateLimitRule,
  consumeRateLimits,
} from '../diagnostics/rate-limit';

const HOUR_MS = 60 * 60 * 1000;

/** Paid calls are counted per user first, then per organization for the hour and for the day */
interface CallLimits {
  perUser: RateLimitRule;
  perOrganization: RateLimitRule;
  perOrganizationDaily: RateLimitRule;
}

/**
 * Claude calls allowed from the AI procedures (#405): every lead handed to Claude counts once,
 * so a batch of 20 leads counts 20. Counted in `public_rate_limits` (fixed windows that start
 * with the first call), so every server instance and every call of a batched tRPC request
 * counts alike. Per user first (across all of the user's organizations, so creating more
 * organizations does not raise it), then per organization for the hour and for the day.
 */
export const AI_CALL_LIMITS = {
  perUser: { name: 'ai-call-user', limit: 60, windowMs: HOUR_MS },
  perOrganization: { name: 'ai-call-org', limit: 120, windowMs: HOUR_MS },
  perOrganizationDaily: { name: 'ai-call-org-day', limit: 500, windowMs: 24 * HOUR_MS },
} as const satisfies CallLimits;

/**
 * OpenAI embedding calls allowed from the AI procedures (#576): embedding a search query
 * (`ai.semanticSearch`) or a lead (`ai.updateEmbedding`) counts once. Counted like
 * AI_CALL_LIMITS but in counters of their own: one embedding costs far less than one Claude
 * call, and searching must not use up the calls left for scoring (nor scoring the searches).
 */
export const EMBEDDING_CALL_LIMITS = {
  perUser: { name: 'ai-embedding-user', limit: 300, windowMs: HOUR_MS },
  perOrganization: { name: 'ai-embedding-org', limit: 600, windowMs: HOUR_MS },
  perOrganizationDaily: { name: 'ai-embedding-org-day', limit: 3_000, windowMs: 24 * HOUR_MS },
} as const satisfies CallLimits;

function limitLabels({
  perUser,
  perOrganization,
  perOrganizationDaily,
}: CallLimits): Record<string, string> {
  return {
    [perUser.name]: `1時間に${perUser.limit}件・ユーザーごと`,
    [perOrganization.name]: `1時間に${perOrganization.limit}件・組織ごと`,
    [perOrganizationDaily.name]: `1日に${perOrganizationDaily.limit}件・組織ごと`,
  };
}

const LIMIT_LABELS: Record<string, string> = {
  ...limitLabels(AI_CALL_LIMITS),
  ...limitLabels(EMBEDDING_CALL_LIMITS),
};

function retryAfterText(seconds: number): string {
  const minutes = Math.ceil(seconds / 60);
  return minutes < 120 ? `約${minutes}分後` : `約${Math.ceil(minutes / 60)}時間後`;
}

interface CallCount {
  userId: string;
  organizationId: string;
  calls: number;
}

/** Count the calls against `limits` in order, or throw TOO_MANY_REQUESTS naming the limit */
async function consumeCalls(
  database: RateLimitDatabase,
  limits: CallLimits,
  usage: string,
  { userId, organizationId, calls }: CallCount,
  now: Date
): Promise<void> {
  const { perUser, perOrganization, perOrganizationDaily } = limits;
  const quota = await consumeRateLimits(
    database,
    [
      { rule: perUser, identifier: userId, cost: calls },
      { rule: perOrganization, identifier: organizationId, cost: calls },
      { rule: perOrganizationDaily, identifier: organizationId, cost: calls },
    ],
    now
  );
  if (!quota.allowed) {
    throw new TRPCError({
      code: 'TOO_MANY_REQUESTS',
      message: `${usage}の上限（${LIMIT_LABELS[quota.rule]}）に達しました。${retryAfterText(quota.retryAfterSeconds)}にもう一度お試しください`,
    });
  }
}

/**
 * Count `calls` Claude calls for the user and the organization, or throw TOO_MANY_REQUESTS.
 * Call it right before Claude is called, once the lead(s) have been found in the organization,
 * so refused and invalid requests to other organizations' leads use up nothing. A request that
 * a limit refuses has still been counted by the limits before it (and by that one).
 */
export async function consumeAiCalls(
  database: RateLimitDatabase,
  count: CallCount,
  now: Date = new Date()
): Promise<void> {
  await consumeCalls(database, AI_CALL_LIMITS, 'AI の利用', count, now);
}

/**
 * Count `calls` OpenAI embedding calls for the user and the organization, or throw
 * TOO_MANY_REQUESTS. Call it right before the text is embedded, after the permission check and
 * once the lead (if any) has been found in the organization, as with consumeAiCalls.
 */
export async function consumeEmbeddingCalls(
  database: RateLimitDatabase,
  count: CallCount,
  now: Date = new Date()
): Promise<void> {
  await consumeCalls(database, EMBEDDING_CALL_LIMITS, 'AI 検索・埋め込みの利用', count, now);
}
