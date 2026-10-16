import { db } from '@/lib/db/client';
import { filterAllowedRecipients } from '@/lib/email/allowed-recipients';
import { env } from '@/lib/env';
import { isEmailConfigured, sendEmail } from '@/lib/features/email';
import { notifyOrganizationMembers } from '@/lib/features/notifications/notification-service';
import { triggerWebhooks } from '@/lib/features/webhooks/services/webhook-service';
import { addBusinessDays } from 'date-fns';
import { consumeRateLimit } from '../rate-limit';
import { AX_MIGRATION_CONFIG } from './config';
import type { AxMigrationResult } from './evaluate';
import { AX_RATE_LIMITS } from './limits';
import {
  type AxMqlJudgement,
  type AxMqlLevel,
  type AxMqlRequired,
  type AxMqlSignal,
  readAxMql,
  withConsultationSignal,
} from './mql';

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

/** 強いシグナル (#139), the wording of the lead page */
const MQL_SIGNAL_LABELS: Record<AxMqlSignal, string> = {
  consultation: '相談申込',
  support_deadline: '保守期限・サポート終了が近い',
  decision_role: '決裁に関わる立場',
  timeline_soon: '切り替え時期が1年以内',
  min_score: 'リードスコアが基準以上',
  web_diagnosis: 'Web診断の完了（旧ルール）',
};
const MQL_REQUIRED_LABELS: Record<AxMqlRequired, string> = {
  industry: '業種',
  system: 'システム',
};
/** Tag in the subject: sales see the order 相談申込 > 関心あり（MQL） > 適合 at a glance */
const MQL_SUBJECT_TAGS: Record<AxMqlLevel, string> = {
  interest: '・関心あり（MQL）',
  fit: '・適合',
  none: '',
};

/**
 * The judgement shown to sales. Results stored before #139 have no level (read as 適合 /
 * 対象外); a consultation request always counts, even when the stored result predates it.
 */
function salesMql(n: AxMigrationNotification): AxMqlJudgement {
  return n.consultationRequested
    ? withConsultationSignal(n.result.mql, AX_MIGRATION_CONFIG.mql)
    : readAxMql(n.result.mql);
}

/** One line on the MQL judgement and why */
export function mqlSummary(mql: AxMqlJudgement): string {
  const signals = mql.signals.map((signal) => MQL_SIGNAL_LABELS[signal]).join('・');
  switch (mql.level) {
    case 'interest':
      return `MQL: 関心あり（${signals}）`;
    case 'fit':
      return 'MQL: 適合のみ（業種・システムは対象。関心を示す行動・回答はまだありません）';
    default:
      return `MQL: 対象外（${mql.unmet.map((key) => MQL_REQUIRED_LABELS[key]).join('・')}が対象外）`;
  }
}

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
  const mql = salesMql(n);
  const tag = MQL_SUBJECT_TAGS[mql.level];
  const platform = n.result.platform ? PLATFORM_LABELS[n.result.platform] : undefined;
  const summary = [
    ...(platform ? [`移行元: ${platform}`] : []),
    `移行難易度: ${LEVEL_LABELS[n.result.difficulty.level]}`,
    `緊急度: ${LEVEL_LABELS[n.result.urgency.level]}`,
    `主な課題: ${primary ? CHALLENGE_LABELS[primary] : '特になし'}`,
    mqlSummary(mql),
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
      title: `【相談申込${tag}${n.identityUnverified ? '・本人未確認' : ''}】${n.company} ${n.name} 様（${deadline} までに連絡）`,
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
      title: `【AX診断・別システム${tag}】${n.company} ${n.name} 様が別のシステムも診断しました`,
      message: `${additional}${summary}`,
    };
  }
  return {
    title: `【AX診断${tag}】${n.company} ${n.name} 様が診断を完了しました`,
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
  const mql = salesMql(n);
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
      // mql = 関心あり（MQL）, mqlCandidate = 適合 (#139)
      mql: mql.qualified,
      mqlCandidate: mql.candidate,
      mqlLevel: mql.level,
      mqlSignals: mql.signals,
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
  // In test mode only company addresses are mailed; decide that before using the quota
  const salesRecipients = filterAllowedRecipients(
    salesEmail ? salesEmail.split(',').map((address) => address.trim()) : []
  );
  if (n.consultationRequested && salesEmail && salesRecipients.length === 0) {
    console.warn('AX consultation: no sales email sent (no sales address is allowed in test mode)');
  }
  if (
    n.consultationRequested &&
    salesRecipients.length > 0 &&
    isEmailConfigured() &&
    (await withinSalesEmailQuota(n.organizationId))
  ) {
    const leadUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/ja/leads/${n.leadId}`;
    tasks.push(
      sendEmail({
        to: salesRecipients,
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

type OrganizationLimit =
  | typeof AX_RATE_LIMITS.notificationsPerOrganization
  | typeof AX_RATE_LIMITS.salesEmailPerOrganizationHourly
  | typeof AX_RATE_LIMITS.salesEmailPerOrganization;

const CHECK_THE_LIST =
  'この間に届いた相談申込は、リード一覧（コンバージョンポイント：相談申込）で確認してください。';

const LIMIT_NOTICES: Record<OrganizationLimit['name'], { title: string; message: string }> = {
  [AX_RATE_LIMITS.notificationsPerOrganization.name]: {
    title: '【AX診断】通知を一時停止しました',
    message: `AX診断の通知が1時間に${AX_RATE_LIMITS.notificationsPerOrganization.limit}件を超えたため、この1時間の残りの送信と相談申込は通知しません（リードとしては保存しています）。${CHECK_THE_LIST}いたずらによる大量の送信の可能性があります。`,
  },
  [AX_RATE_LIMITS.salesEmailPerOrganizationHourly.name]: {
    title: '【AX診断】営業宛てメールを一時停止しました',
    message: `相談申込のメールが1時間に${AX_RATE_LIMITS.salesEmailPerOrganizationHourly.limit}通を超えたため、この1時間の残りの相談申込はアプリ内通知だけでお知らせします。${CHECK_THE_LIST}`,
  },
  [AX_RATE_LIMITS.salesEmailPerOrganization.name]: {
    title: '【AX診断】営業宛てメールを一時停止しました',
    message: `相談申込のメールが1日${AX_RATE_LIMITS.salesEmailPerOrganization.limit}通を超えたため、今日のこれ以降の相談申込はアプリ内通知だけでお知らせします。${CHECK_THE_LIST}`,
  },
};

/**
 * Tell the members (in-app) and sales (one email, outside the email caps: it is sent once per
 * limit and window) that a limit has stopped some notifications
 */
async function noticeLimitReached(organizationId: string, rule: OrganizationLimit): Promise<void> {
  const notice = LIMIT_NOTICES[rule.name];
  const salesEmail = env.AX_DIAGNOSIS_SALES_EMAIL;
  const results = await Promise.allSettled([
    notifyOrganizationMembers(organizationId, 'system', notice.title, notice.message, {
      diagnosticKey: 'ax-migration',
      limit: rule.name,
    }),
    ...(salesEmail && isEmailConfigured()
      ? [
          sendEmail({
            to: salesEmail.split(',').map((address) => address.trim()),
            subject: notice.title,
            text: notice.message,
            html: `<p>${escapeHtml(notice.message)}</p>`,
          }),
        ]
      : []),
  ]);
  for (const result of results) {
    if (result.status === 'rejected') {
      console.error('AX diagnosis: limit notice failed:', result.reason);
    }
  }
}

/** Count one against a limit of the organization; the first time it is over, say so */
async function withinOrganizationLimit(
  rule: OrganizationLimit,
  organizationId: string
): Promise<boolean> {
  const quota = await consumeRateLimit(db, rule, organizationId);
  if (quota.allowed) return true;
  console.warn(`AX diagnosis: limit ${rule.name} reached`);
  if (quota.count === rule.limit + 1) await noticeLimitReached(organizationId, rule);
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
 * Hourly and daily caps on sales emails (the daily one is not used up by emails the hourly one
 * refused); when they cannot be checked, no email (the sending quota is shared with the password
 * reset emails)
 */
async function withinSalesEmailQuota(organizationId: string): Promise<boolean> {
  try {
    return (
      (await withinOrganizationLimit(
        AX_RATE_LIMITS.salesEmailPerOrganizationHourly,
        organizationId
      )) &&
      (await withinOrganizationLimit(AX_RATE_LIMITS.salesEmailPerOrganization, organizationId))
    );
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
