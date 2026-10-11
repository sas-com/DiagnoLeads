import { db } from '@/lib/db/client';
import { env } from '@/lib/env';
import { isEmailConfigured, sendEmail } from '@/lib/features/email';
import { notifyOrganizationMembers } from '@/lib/features/notifications/notification-service';
import { triggerWebhooks } from '@/lib/features/webhooks/services/webhook-service';
import { addBusinessDays } from 'date-fns';
import { consumeRateLimit } from '../rate-limit';
import { AX_MIGRATION_CONFIG } from './config';
import type { AxMigrationResult } from './evaluate';
import { AX_RATE_LIMITS } from './limits';

const LEVEL_LABELS = { low: '低', medium: '中', high: '高' } as const;
const PLATFORM_LABELS: Record<string, string> = {
  as400: 'AS/400（IBM i）',
  acos: 'NEC ACOS',
  access: 'Microsoft Access',
  other: 'その他・わからない',
};
const CHALLENGE_LABELS = {
  people: 'ヒト（担い手不足・属人化）',
  cost: 'カネ（保守・延命コスト）',
  agility: 'モノ（市場変化への対応）',
  data: '情報（データ活用）',
} as const;

export interface AxMigrationNotification {
  organizationId: string;
  leadId: string;
  submissionId: string;
  company: string;
  name: string;
  email: string;
  result: Pick<
    AxMigrationResult,
    'difficulty' | 'urgency' | 'challenges' | 'mql' | 'sqlSignals' | 'leadScore' | 'needsHearing'
  > &
    Partial<Pick<AxMigrationResult, 'platform'>>;
  consultationRequested: boolean;
  leadCreated: boolean;
  /**
   * The email matched an existing lead, and the submission is not another system diagnosed
   * from the result screen of the submission that created it. The public form cannot prove who
   * answered, so sales must confirm before acting; company / name come from the DB.
   */
  identityUnverified: boolean;
  /**
   * Another system diagnosed from the result screen of the submission that created the lead
   * (the same browser, checked on the server; not a check of who owns the address). The system
   * is recorded on the lead.
   */
  additionalSystem?: boolean;
  requestedAt: Date;
}

/**
 * 相談申込への連絡期限（土日を除く営業日。祝日は考慮しない）
 * Counted on the Japan calendar regardless of the server time zone (Vercel runs in UTC).
 * Returns the deadline as a JST calendar date in yyyy/MM/dd.
 */
export function consultationDeadline(
  requestedAt: Date,
  businessDays = AX_MIGRATION_CONFIG.consultationResponseBusinessDays
): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(requestedAt);
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  // Build a UTC-noon date for the JST calendar day so weekday math is time-zone independent
  const jstDay = new Date(Date.UTC(part('year'), part('month') - 1, part('day'), 12));
  const deadline = addBusinessDays(jstDay, businessDays);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${deadline.getUTCFullYear()}/${pad(deadline.getUTCMonth() + 1)}/${pad(deadline.getUTCDate())}`;
}

export function buildSalesMessage(n: AxMigrationNotification): { title: string; message: string } {
  const primary = n.result.challenges.primary;
  const platform = n.result.platform ? PLATFORM_LABELS[n.result.platform] : undefined;
  const summary = [
    ...(platform ? [`移行元: ${platform}`] : []),
    `移行難易度: ${LEVEL_LABELS[n.result.difficulty.level]}`,
    `緊急度: ${LEVEL_LABELS[n.result.urgency.level]}`,
    `主な課題: ${primary ? CHALLENGE_LABELS[primary] : '特になし'}`,
    n.result.mql.qualified
      ? 'MQL: 該当'
      : `MQL候補: ${n.result.mql.candidate ? '該当（マーケで確定してください）' : '非該当'}`,
    `SQLの手がかり: ${n.result.sqlSignals.candidate ? 'あり' : 'なし'}`,
    ...(n.result.needsHearing ? ['「わからない」の回答が多く要ヒアリング'] : []),
  ].join(' / ');
  const unverified = n.identityUnverified
    ? '既存リードと同じメールアドレスからの回答です。本人確認のうえ対応してください（リードの内容は変更していません）。'
    : '';
  const additional = n.additionalSystem
    ? '最初の診断と同じ画面から、別のシステムも続けて診断されました（リードの診断結果に追記しています）。'
    : '';

  if (n.consultationRequested) {
    const deadline = consultationDeadline(n.requestedAt);
    return {
      title: `【相談申込${n.identityUnverified ? '・本人未確認' : ''}】${n.company} ${n.name} 様（${deadline} までに連絡）`,
      message: `AXマイグレーション診断から相談申込がありました。MQL判定を経ずに営業へ引き渡します。${unverified}${additional}${summary}`,
    };
  }
  if (n.identityUnverified) {
    return {
      title: `【AX診断・本人未確認】既存リード ${n.company} ${n.name} 様のメールアドレスで再回答がありました`,
      message: `${unverified}${summary}`,
    };
  }
  if (n.additionalSystem) {
    return {
      title: `【AX診断・別システム】${n.company} ${n.name} 様が別のシステムも診断しました`,
      message: `${additional}${summary}`,
    };
  }
  return {
    title: `【AX診断】${n.company} ${n.name} 様が診断を完了しました`,
    message: summary,
  };
}

/**
 * Notify sales after a diagnosis or a consultation request.
 * Failures are logged and never break the respondent's flow. Past the hourly limit of the
 * organization nothing is sent (the submission is saved all the same).
 */
export async function notifyAxMigrationSubmission(n: AxMigrationNotification): Promise<void> {
  if (!(await withinNotificationLimit(n.organizationId))) return;
  const { title, message } = buildSalesMessage(n);
  const data = {
    leadId: n.leadId,
    submissionId: n.submissionId,
    diagnosticKey: 'ax-migration',
    consultationRequested: n.consultationRequested,
    identityUnverified: n.identityUnverified,
    additionalSystem: n.additionalSystem ?? false,
  };

  const tasks: Promise<unknown>[] = [
    triggerWebhooks(n.organizationId, 'diagnostic.submitted', {
      ...data,
      email: n.email,
      company: n.company,
      name: n.name,
      score: n.result.leadScore,
      mql: n.result.mql.qualified,
      mqlCandidate: n.result.mql.candidate,
      sqlSignals: n.result.sqlSignals.candidate,
      difficulty: n.result.difficulty.level,
      urgency: n.result.urgency.level,
      primaryChallenge: n.result.challenges.primary,
      platform: n.result.platform ?? null,
    }),
  ];

  // In-app: consultation requests, new leads and another system recorded on a lead. A repeat
  // answer without a consultation request changes nothing on the lead, so it does not ping
  // every member again.
  if (n.consultationRequested || n.leadCreated || n.additionalSystem) {
    tasks.push(
      notifyOrganizationMembers(
        n.organizationId,
        n.consultationRequested
          ? 'consultation_requested'
          : n.leadCreated
            ? 'lead_created'
            : // Another system on an existing lead: a new diagnosis result for it
              'lead_scored',
        title,
        message,
        data
      )
    );
  }

  const salesEmail = env.AX_DIAGNOSIS_SALES_EMAIL;
  if (n.consultationRequested && !(salesEmail && isEmailConfigured())) {
    // Visible in the runtime logs: a missing setting, not a failed send
    console.warn(
      'AX consultation: no sales email sent (AX_DIAGNOSIS_SALES_EMAIL or RESEND_API_KEY is not set)'
    );
  }
  if (
    n.consultationRequested &&
    salesEmail &&
    isEmailConfigured() &&
    (await withinSalesEmailQuota(n.organizationId))
  ) {
    const leadUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/ja/leads?leadId=${n.leadId}`;
    tasks.push(
      sendEmail({
        to: salesEmail.split(',').map((address) => address.trim()),
        subject: title,
        text: `${message}\n\n会社名: ${n.company}\n氏名: ${n.name}\nメール: ${n.email}\nリード: ${leadUrl}`,
        html: `<p>${message}</p><ul><li>会社名: ${escapeHtml(n.company)}</li><li>氏名: ${escapeHtml(n.name)}</li><li>メール: ${escapeHtml(n.email)}</li></ul><p><a href="${leadUrl}">リードを開く</a></p>`,
      })
    );
  }

  const results = await Promise.allSettled(tasks);
  for (const r of results) {
    if (r.status === 'rejected') {
      console.error('AX diagnosis notification failed:', r.reason);
    }
  }
}

const LIMIT_NOTICES = {
  [AX_RATE_LIMITS.notificationsPerOrganization.name]: {
    title: '【AX診断】通知を一時停止しました',
    message: `AX診断の通知が1時間に${AX_RATE_LIMITS.notificationsPerOrganization.limit}件を超えたため、この1時間の残りの送信と相談申込は通知しません（リードとしては保存しています）。いたずらによる大量の送信の可能性があります。`,
  },
  [AX_RATE_LIMITS.salesEmailPerOrganization.name]: {
    title: '【AX診断】営業宛てメールを一時停止しました',
    message: `相談申込のメールが1日${AX_RATE_LIMITS.salesEmailPerOrganization.limit}通を超えたため、今日のこれ以降の相談申込はアプリ内通知だけでお知らせします。`,
  },
} as const;

/** Count one against a limit of the organization; the first time it is over, tell the members */
async function withinOrganizationLimit(
  rule:
    | typeof AX_RATE_LIMITS.notificationsPerOrganization
    | typeof AX_RATE_LIMITS.salesEmailPerOrganization,
  organizationId: string
): Promise<boolean> {
  const quota = await consumeRateLimit(db, rule, organizationId);
  if (quota.allowed) return true;
  console.warn(`AX diagnosis: limit ${rule.name} reached`);
  if (quota.count === rule.limit + 1) {
    const notice = LIMIT_NOTICES[rule.name];
    await notifyOrganizationMembers(organizationId, 'system', notice.title, notice.message, {
      diagnosticKey: 'ax-migration',
      limit: rule.name,
    }).catch((error) => console.error('AX diagnosis: limit notice failed:', error));
  }
  return false;
}

/** Hourly limit on notifications; when it cannot be checked, sales are notified as usual */
async function withinNotificationLimit(organizationId: string): Promise<boolean> {
  try {
    return await withinOrganizationLimit(
      AX_RATE_LIMITS.notificationsPerOrganization,
      organizationId
    );
  } catch (error) {
    console.error('AX diagnosis: notification limit check failed:', error);
    return true;
  }
}

/**
 * Daily cap on sales emails; when it cannot be checked, no email (the sending quota is shared
 * with the password reset emails)
 */
async function withinSalesEmailQuota(organizationId: string): Promise<boolean> {
  try {
    return await withinOrganizationLimit(AX_RATE_LIMITS.salesEmailPerOrganization, organizationId);
  } catch (error) {
    console.error('AX diagnosis: sales email limit check failed:', error);
    return false;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
