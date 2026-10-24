import { TRPCError } from '@trpc/server';
import {
  type RateLimitDatabase,
  type RateLimitRule,
  consumeRateLimits,
} from '../diagnostics/rate-limit';

const HOUR_MS = 60 * 60 * 1000;

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
} as const satisfies Record<string, RateLimitRule>;

const LIMIT_LABELS: Record<string, string> = {
  [AI_CALL_LIMITS.perUser.name]: `1時間に${AI_CALL_LIMITS.perUser.limit}件・ユーザーごと`,
  [AI_CALL_LIMITS.perOrganization.name]:
    `1時間に${AI_CALL_LIMITS.perOrganization.limit}件・組織ごと`,
  [AI_CALL_LIMITS.perOrganizationDaily.name]:
    `1日に${AI_CALL_LIMITS.perOrganizationDaily.limit}件・組織ごと`,
};

function retryAfterText(seconds: number): string {
  const minutes = Math.ceil(seconds / 60);
  return minutes < 120 ? `約${minutes}分後` : `約${Math.ceil(minutes / 60)}時間後`;
}

/**
 * Count `calls` Claude calls for the user and the organization, or throw TOO_MANY_REQUESTS.
 * Call it right before Claude is called, once the lead(s) have been found in the organization,
 * so refused and invalid requests to other organizations' leads use up nothing. A request that
 * a limit refuses has still been counted by the limits before it (and by that one).
 */
export async function consumeAiCalls(
  database: RateLimitDatabase,
  { userId, organizationId, calls }: { userId: string; organizationId: string; calls: number },
  now: Date = new Date()
): Promise<void> {
  const { perUser, perOrganization, perOrganizationDaily } = AI_CALL_LIMITS;
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
      message: `AI の利用の上限（${LIMIT_LABELS[quota.rule]}）に達しました。${retryAfterText(quota.retryAfterSeconds)}にもう一度お試しください`,
    });
  }
}
