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
 * Refusals of the public forms (bot check failed, honeypot filled, too many requests) per place
 * before someone is told: one respondent failing the check now and then is normal, a flood is
 * not (#351)
 */
export const REJECTION_ALERT_RULE: RateLimitRule = {
  name: 'rejected-requests',
  limit: 20,
  windowMs: 10 * 60 * 1000,
};

export type RejectionReason = 'verification_failed' | 'honeypot' | 'rate_limited';

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

/** Count in the shared table, giving up after SHARED_COUNT_TIMEOUT_MS */
async function sharedCount(database: Database, rule: RateLimitRule, key: string, now: Date) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('shared count timed out')), SHARED_COUNT_TIMEOUT_MS);
  });
  try {
    return await Promise.race([consumeRateLimit(database, rule, key, now), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Counted before sending: a mail that fails (Resend down) still uses the place's 10 minutes,
 * so a broken mail service cannot turn every error into a retry
 */
async function allowedToSend(database: Database, where: string, now: Date): Promise<boolean> {
  try {
    const { allowed } = await sharedCount(database, OPS_ALERT_RULE, where, now);
    return allowed;
  } catch {
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
    const rows = [
      { label: '発生場所', value: where },
      { label: '時刻', value: now.toISOString() },
      { label: '種類', value: `${summary.name}${summary.code ? ` (${summary.code})` : ''}` },
      ...(summary.table ? [{ label: '表', value: summary.table }] : []),
      ...(summary.constraint ? [{ label: '制約', value: summary.constraint }] : []),
    ];
    await sendOpsAlert(to, {
      subject: `[DiagnoLeads] サーバーエラー: ${where}`,
      preheader: `${where} で ${summary.name} が発生しました`,
      heading: 'サーバーエラー',
      rows,
      code: summary.frames.length > 0 ? summary.frames.join('\n') : undefined,
      note: '同じ発生場所の通知は10分に1通までです。詳しくは Vercel のログを確認してください。',
    });
  } catch (alertError) {
    console.error('Server error alert failed:', summarizeServerError(alertError));
  }
}

interface OpsAlert {
  subject: string;
  preheader: string;
  heading: string;
  rows: { label: string; value: string }[];
  code?: string;
  note: string;
}

/** One internal alert mail, built by renderEmail like every other mail */
async function sendOpsAlert(to: string[], alert: OpsAlert): Promise<void> {
  await sendEmail({
    to,
    subject: alert.subject,
    ...renderEmail({
      theme: 'internal',
      preheader: alert.preheader,
      blocks: [
        { type: 'heading', text: alert.heading },
        {
          type: 'facts',
          rows: [
            ...alert.rows,
            { label: '版', value: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? '不明' },
          ],
        },
        ...(alert.code ? [{ type: 'code' as const, text: alert.code }] : []),
        { type: 'paragraph', text: alert.note, muted: true },
      ],
      footer: ['このメールは DiagnoLeads から自動で送信しています。'],
    }),
  });
}

/**
 * A public form refused a request as a likely bot (#351). Logs the place and reason, counts it
 * per place in the shared table, and when the count passes REJECTION_ALERT_RULE.limit within
 * the window, emails the same people as a server error (once per place per window).
 * Holds nothing about the sender. Never throws: call it after the response, e.g. in after().
 */
export async function reportRejectedRequest(
  where: string,
  reason: RejectionReason,
  { database, now = new Date() }: { database?: Database; now?: Date } = {}
): Promise<void> {
  console.warn(`Public form refused a request: ${where} (${reason})`);
  try {
    // Nobody to tell (development, previews): nothing is counted
    const to = recipients();
    if (to.length === 0 || !isEmailConfigured()) return;
    const db = database ?? (await import('@/lib/db/client')).db;
    // One write per refusal. The count is atomic, so exactly one refusal of the window sees
    // limit + 1 and sends; a flood adds no second write per request
    const { count } = await sharedCount(db, REJECTION_ALERT_RULE, where, now);
    if (count !== REJECTION_ALERT_RULE.limit + 1) return;

    const minutes = REJECTION_ALERT_RULE.windowMs / 60_000;
    await sendOpsAlert(to, {
      subject: `[DiagnoLeads] 公開フォームで断った送信が多くなっています: ${where}`,
      preheader: `${where} で ${minutes}分間に ${count} 件を断りました`,
      heading: '断った送信が多くなっています',
      rows: [
        { label: '発生場所', value: where },
        { label: '時刻', value: now.toISOString() },
        {
          label: `${minutes}分間に断った件数`,
          value: `${count} 件（${REJECTION_ALERT_RULE.limit} 件を超えたら通知）`,
        },
        { label: '最後の理由', value: reason },
      ],
      note: 'ボットによる大量送信の可能性があります。Cloudflare の Turnstile の画面と Vercel のログで、状況を確認してください。同じ発生場所の通知は10分に1通までです。',
    });
  } catch (alertError) {
    console.error('Rejection alert failed:', summarizeServerError(alertError));
  }
}
