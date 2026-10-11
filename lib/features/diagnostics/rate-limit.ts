import { createHmac } from 'node:crypto';
import type { db as defaultDb } from '@/lib/db/client';
import { publicRateLimits } from '@/lib/db/schema';
import { env } from '@/lib/env';
import { lt, sql } from 'drizzle-orm';

type Database = typeof defaultDb;

/** One limit: at most `limit` requests per `windowMs` for the same identifier */
export interface RateLimitRule {
  /** Short name; part of the key, so each rule counts separately */
  name: string;
  limit: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the current window ends (for Retry-After) */
  retryAfterSeconds: number;
}

/** Windows that ended this long ago are deleted */
const PRUNE_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * Key of a rule and identifier (IP address, email, organization).
 * A keyed hash: the table holds no IP address or email, and without the server secret the
 * hashes cannot be matched by hashing guessed values.
 */
export function rateLimitKey(rule: RateLimitRule, identifier: string): string {
  const digest = createHmac('sha256', env.BETTER_AUTH_SECRET)
    .update(`public-rate-limit:${rule.name}:${identifier}`)
    .digest('base64url');
  return `${rule.name}:${digest.slice(0, 32)}`;
}

/**
 * Count one request in a fixed window shared by every server instance (the in-memory limit in
 * the middleware is per instance, so it does not hold on serverless). The first request after
 * a window has ended starts the next one. A single upsert, so concurrent requests all count.
 */
export async function consumeRateLimit(
  database: Database,
  rule: RateLimitRule,
  identifier: string,
  now: Date = new Date()
): Promise<RateLimitResult> {
  const resetAt = new Date(now.getTime() + rule.windowMs);
  const expired = sql`${publicRateLimits.resetAt} <= ${now.toISOString()}::timestamptz`;
  const [row] = await database
    .insert(publicRateLimits)
    .values({ key: rateLimitKey(rule, identifier), count: 1, resetAt })
    .onConflictDoUpdate({
      target: publicRateLimits.key,
      set: {
        count: sql`case when ${expired} then 1 else ${publicRateLimits.count} + 1 end`,
        resetAt: sql`case when ${expired} then ${resetAt.toISOString()}::timestamptz else ${publicRateLimits.resetAt} end`,
      },
    })
    .returning({ count: publicRateLimits.count, resetAt: publicRateLimits.resetAt });

  return {
    allowed: row.count <= rule.limit,
    retryAfterSeconds: Math.max(1, Math.ceil((row.resetAt.getTime() - now.getTime()) / 1000)),
  };
}

/**
 * Count the request against every rule (each one counts it, also when another refuses);
 * refused when any rule is over its limit.
 */
export async function consumeRateLimits(
  database: Database,
  checks: { rule: RateLimitRule; identifier: string }[],
  now: Date = new Date()
): Promise<RateLimitResult & { rule?: string }> {
  const results = await Promise.all(
    checks.map(async ({ rule, identifier }) => ({
      rule: rule.name,
      ...(await consumeRateLimit(database, rule, identifier, now)),
    }))
  );
  const refused = results.filter((result) => !result.allowed);
  if (refused.length === 0) return { allowed: true, retryAfterSeconds: 0 };
  return {
    allowed: false,
    rule: refused[0].rule,
    retryAfterSeconds: Math.max(...refused.map((result) => result.retryAfterSeconds)),
  };
}

/** Delete windows that ended a day ago or earlier */
export async function pruneRateLimits(database: Database, now: Date = new Date()): Promise<void> {
  await database
    .delete(publicRateLimits)
    .where(lt(publicRateLimits.resetAt, new Date(now.getTime() - PRUNE_AFTER_MS)));
}
