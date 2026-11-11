import { createHmac } from 'node:crypto';
import type { db as defaultDb } from '@/lib/db/client';
import { publicRateLimits } from '@/lib/db/schema';
import { env } from '@/lib/env';
import { inArray, lt, sql } from 'drizzle-orm';

type Database = typeof defaultDb;

/** The database or a transaction of it: counting only needs an insert */
export type RateLimitDatabase = Pick<Database, 'insert'>;

/** One limit: at most `limit` requests per `windowMs` for the same identifier */
export interface RateLimitRule {
  /** Short name; part of the key, so each rule counts separately */
  name: string;
  limit: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Requests counted in the current window, this one included */
  count: number;
  /** Seconds until the current window ends (for Retry-After) */
  retryAfterSeconds: number;
}

/** Windows that ended this long ago are deleted */
const PRUNE_AFTER_MS = 24 * 60 * 60 * 1000;
/** Rows deleted per cleanup, so one cleanup stays short however many have piled up */
const PRUNE_BATCH = 500;

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
 *
 * `cost` counts one request as several (a batch of paid AI calls counts each call). A request
 * the rule refuses has still been counted, whatever its cost, like every refused request.
 */
export async function consumeRateLimit(
  database: RateLimitDatabase,
  rule: RateLimitRule,
  identifier: string,
  now: Date = new Date(),
  cost = 1
): Promise<RateLimitResult> {
  if (!Number.isInteger(cost) || cost < 1) {
    throw new RangeError(`Rate limit cost must be a positive integer, got ${cost}`);
  }
  const resetAt = new Date(now.getTime() + rule.windowMs);
  const expired = sql`${publicRateLimits.resetAt} <= ${now.toISOString()}::timestamptz`;
  const [row] = await database
    .insert(publicRateLimits)
    .values({ key: rateLimitKey(rule, identifier), count: cost, resetAt })
    .onConflictDoUpdate({
      target: publicRateLimits.key,
      set: {
        count: sql`case when ${expired} then ${cost}::int else ${publicRateLimits.count} + ${cost}::int end`,
        resetAt: sql`case when ${expired} then ${resetAt.toISOString()}::timestamptz else ${publicRateLimits.resetAt} end`,
      },
    })
    .returning({ count: publicRateLimits.count, resetAt: publicRateLimits.resetAt });

  return {
    allowed: row.count <= rule.limit,
    count: row.count,
    retryAfterSeconds: Math.max(1, Math.ceil((row.resetAt.getTime() - now.getTime()) / 1000)),
  };
}

/**
 * Count the request against the rules in order and stop at the first that refuses it: the
 * later (wider) rules are not used up by requests that were refused anyway.
 */
export async function consumeRateLimits(
  database: RateLimitDatabase,
  checks: { rule: RateLimitRule; identifier: string; cost?: number }[],
  now: Date = new Date()
): Promise<{ allowed: true } | { allowed: false; rule: string; retryAfterSeconds: number }> {
  for (const { rule, identifier, cost } of checks) {
    const result = await consumeRateLimit(database, rule, identifier, now, cost);
    if (!result.allowed) {
      return { allowed: false, rule: rule.name, retryAfterSeconds: result.retryAfterSeconds };
    }
  }
  return { allowed: true };
}

/** Delete windows that ended a day ago or earlier, a batch at a time */
export async function pruneRateLimits(database: Database, now: Date = new Date()): Promise<void> {
  const expired = database
    .select({ key: publicRateLimits.key })
    .from(publicRateLimits)
    .where(lt(publicRateLimits.resetAt, new Date(now.getTime() - PRUNE_AFTER_MS)))
    .limit(PRUNE_BATCH);
  await database.delete(publicRateLimits).where(inArray(publicRateLimits.key, expired));
}
