import type { db as defaultDb } from '@/lib/db/client';
import { unwrapQueryError } from '@/lib/db/query-error';
import { renderEmail } from '@/lib/email/templates/render';
import { env } from '@/lib/env';
import { type RateLimitRule, consumeRateLimit } from '@/lib/features/diagnostics/rate-limit';
import { isEmailConfigured, sendEmail } from '@/lib/features/email';

type Database = typeof defaultDb;

/** One alert per place every 10 minutes: an outage must not flood the mailbox */
export const OPS_ALERT_RULE: RateLimitRule = {
  name: 'ops-alert',
  limit: 1,
  windowMs: 10 * 60 * 1000,
};

/**
 * The shared count waits at most this long: when the database is down the request has already
 * spent its connect timeout, and the alert must still go out within the function's time limit
 */
const SHARED_COUNT_TIMEOUT_MS = 2000;

/** When the database itself is down the shared count is unavailable: count per instance */
const lastSentInInstance = new Map<string, number>();

export interface ServerErrorSummary {
  name: string;
  code?: string;
  table?: string;
  constraint?: string;
  /** Code locations only: the first stack line (the message) can hold values */
  frames: string[];
}

/**
 * What of an error goes into the alert: names and code locations, never its message or
 * database detail (they can hold a respondent's email address or answers)
 */
export function summarizeServerError(thrown: unknown): ServerErrorSummary {
  const error = unwrapQueryError(thrown);
  if (!(error instanceof Error)) return { name: typeof error, frames: [] };
  const fields = error as Error & Record<string, unknown>;
  const text = (value: unknown) => (typeof value === 'string' ? value : undefined);
  return {
    name: error.name,
    code: text(fields.code),
    table: text(fields.table_name),
    constraint: text(fields.constraint_name),
    frames: (error.stack ?? '')
      .split('\n')
      .slice(1)
      .map((line) => line.trim())
      // Real frames end with file:line:column; a multi-line message cannot pass as one
      .filter((line) => /^at .+:\d+:\d+\)?$/.test(line))
      .slice(0, 8),
  };
}

function recipients(): string[] {
  const list = env.OPS_ALERT_EMAIL ?? env.AX_DIAGNOSIS_SALES_EMAIL ?? '';
  return list
    .split(',')
    .map((address) => address.trim())
    .filter(Boolean);
}

/**
 * Counted before sending: a mail that fails (Resend down) still uses the place's 10 minutes,
 * so a broken mail service cannot turn every error into a retry
 */
async function allowedToSend(database: Database, where: string, now: Date): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('shared count timed out')),
        SHARED_COUNT_TIMEOUT_MS
      );
    });
    const { allowed } = await Promise.race([
      consumeRateLimit(database, OPS_ALERT_RULE, where, now),
      timeout,
    ]);
    clearTimeout(timer);
    return allowed;
  } catch {
    clearTimeout(timer);
    const last = lastSentInInstance.get(where);
    if (last !== undefined && now.getTime() - last < OPS_ALERT_RULE.windowMs) return false;
    lastSentInInstance.set(where, now.getTime());
    return true;
  }
}

/**
 * Tell the people on call that a server error happened (#227). Logs as before, then emails
 * OPS_ALERT_EMAIL (or the AX sales address) at most once per place every 10 minutes. Never
 * throws: a failed alert must not break the request that failed.
 */
export async function reportServerError(
  where: string,
  error: unknown,
  { database, now = new Date() }: { database?: Database; now?: Date } = {}
): Promise<void> {
  try {
    const to = recipients();
    if (to.length === 0 || !isEmailConfigured()) return;
    const db = database ?? (await import('@/lib/db/client')).db;
    if (!(await allowedToSend(db, where, now))) return;

    const summary = summarizeServerError(error);
    const facts = [
      { label: '発生場所', value: where },
      { label: '時刻', value: now.toISOString() },
      { label: '種類', value: `${summary.name}${summary.code ? ` (${summary.code})` : ''}` },
      ...(summary.table ? [{ label: '表', value: summary.table }] : []),
      ...(summary.constraint ? [{ label: '制約', value: summary.constraint }] : []),
      { label: '版', value: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? '不明' },
    ];
    await sendEmail({
      to,
      subject: `[DiagnoLeads] サーバーエラー: ${where}`,
      ...renderEmail({
        theme: 'internal',
        preheader: `${where} で ${summary.name} が発生しました`,
        blocks: [
          { type: 'heading', text: 'サーバーエラー' },
          { type: 'facts', rows: facts },
          ...(summary.frames.length > 0
            ? [{ type: 'code' as const, text: summary.frames.join('\n') }]
            : []),
          {
            type: 'paragraph',
            text: '同じ発生場所の通知は10分に1通までです。詳しくは Vercel のログを確認してください。',
            muted: true,
          },
        ],
        footer: ['このメールは DiagnoLeads から自動で送信しています。'],
      }),
    });
  } catch (alertError) {
    console.error('Server error alert failed:', summarizeServerError(alertError));
  }
}
