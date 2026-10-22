/**
 * Sales notifications of builder diagnoses (Refs #116), in the same format and flow as the AX
 * diagnosis (lib/features/diagnostics/ax-migration/notify.ts): a consultation request gets the
 * company, the contact deadline (2 business days, JST) and the MQL reasons in the title / body,
 * and an email with a link to the lead page. Respondents of a diagnosis are never mailed here.
 */
import { db } from '@/lib/db/client';
import { filterAllowedRecipients } from '@/lib/email/allowed-recipients';
import { type EmailBlock, type EmailFact, renderEmail } from '@/lib/email/templates/render';
import { env } from '@/lib/env';
import { isEmailConfigured, sendEmail } from '@/lib/features/email';
import { notifyOrganizationMembers } from '@/lib/features/notifications/notification-service';
import { sendLeadCreatedById } from '@/lib/features/webhooks/services/lead-events';
import { triggerWebhooks } from '@/lib/features/webhooks/services/webhook-service';
import { AX_RATE_LIMITS } from '../diagnostics/ax-migration/limits';
import { consultationDeadline } from '../diagnostics/ax-migration/notify';
import { consumeRateLimit } from '../diagnostics/rate-limit';
import type { DiagnosisMqlLevel } from './evaluate';
import { DIAGNOSIS_RATE_LIMITS } from './limits';

/** Tag in the subject, the same as the AX diagnosis: 相談申込 > 関心あり（MQL） > 適合 */
const MQL_SUBJECT_TAGS: Record<DiagnosisMqlLevel, string> = {
  interest: '・関心あり（MQL）',
  fit: '・適合',
  none: '',
};

/** One line on the MQL judgement and why, worded like the AX diagnosis */
export function diagnosisMqlSummary(level: DiagnosisMqlLevel, reasons: string[]): string {
  switch (level) {
    case 'interest':
      return `MQL: 関心あり（${reasons.join('・')}）`;
    case 'fit':
      return 'MQL: 適合のみ（必須条件は満たしています。関心を示す行動・回答はまだありません）';
    default:
      return 'MQL: 対象外（必須条件を満たしていません）';
  }
}

export interface DiagnosisNotification {
  organizationId: string;
  diagnosisId: string;
  /** The title respondents saw (definition title of the answered version) */
  diagnosisTitle: string;
  leadId: string;
  submissionId: string;
  company: string;
  name: string;
  email: string;
  resultTypeName: string | null;
  leadScore: number;
  /** 関心あり（MQL） / 適合 / 対象外, as in the AX diagnosis (#139) */
  mqlLevel: DiagnosisMqlLevel;
  mqlQualified: boolean;
  /** Texts from the definition (strong signals, minimum score) and 相談申込 */
  mqlReasons: string[];
  consultationRequested: boolean;
  leadCreated: boolean;
  /**
   * The email matched an existing lead: the public form cannot prove who answered, so sales must
   * confirm before acting; company / name come from the DB.
   */
  identityUnverified: boolean;
  requestedAt: Date;
}

export function leadPageUrl(leadId: string): string {
  return `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/ja/leads/${leadId}`;
}

export function buildDiagnosisSalesMessage(n: DiagnosisNotification): {
  title: string;
  message: string;
} {
  const summary = [
    `診断: ${n.diagnosisTitle}`,
    `結果: ${n.resultTypeName ?? '該当なし'}`,
    `リードスコア: ${n.leadScore}`,
    diagnosisMqlSummary(n.mqlLevel, n.mqlReasons),
  ].join(' / ');
  const tag = MQL_SUBJECT_TAGS[n.mqlLevel];
  const unverified = n.identityUnverified
    ? '既存リードと同じメールアドレスからの回答です。本人確認のうえ対応してください（リードの内容は変更していません）。'
    : '';

  if (n.consultationRequested) {
    const deadline = consultationDeadline(n.requestedAt);
    return {
      title: `【相談申込${tag}${n.identityUnverified ? '・本人未確認' : ''}】${n.company} ${n.name} 様（${deadline} までに連絡）`,
      message: `${n.diagnosisTitle}から相談申込がありました。MQL判定を経ずに営業へ引き渡します。${unverified}${summary}`,
    };
  }
  if (n.identityUnverified) {
    return {
      title: `【診断${tag}・本人未確認】既存リード ${n.company} ${n.name} 様のメールアドレスで回答がありました`,
      message: `${unverified}${summary}`,
    };
  }
  return {
    title: `【診断${tag}】${n.company} ${n.name} 様が「${n.diagnosisTitle}」を完了しました`,
    message: summary,
  };
}

/**
 * The sales email (#285): the same judgement as the in-app message, laid out like the AX
 * diagnosis as badges, the customer, the result and a button to the lead
 */
export function buildDiagnosisSalesEmail(n: DiagnosisNotification): {
  subject: string;
  html: string;
  text: string;
} {
  const { title } = buildDiagnosisSalesMessage(n);
  const url = leadPageUrl(n.leadId);
  const deadline = n.consultationRequested ? consultationDeadline(n.requestedAt) : null;

  const badges: Extract<EmailBlock, { type: 'badges' }>['items'] = [
    ...(n.consultationRequested ? [{ label: '相談申込', tone: 'danger' as const }] : []),
    ...(n.mqlLevel === 'interest'
      ? [{ label: '関心あり（MQL）', tone: 'warning' as const }]
      : n.mqlLevel === 'fit'
        ? [{ label: '適合', tone: 'info' as const }]
        : []),
    ...(n.identityUnverified ? [{ label: '本人未確認', tone: 'warning' as const }] : []),
  ];
  const result: EmailFact[] = [
    { label: '診断', value: n.diagnosisTitle },
    { label: '結果', value: n.resultTypeName ?? '該当なし' },
    { label: 'リードスコア', value: String(n.leadScore) },
    { label: 'MQL', value: diagnosisMqlSummary(n.mqlLevel, n.mqlReasons).replace(/^MQL: /, '') },
    ...n.mqlReasons.map((reason) => ({ label: 'MQLの理由', value: reason })),
  ];

  const rendered = renderEmail({
    theme: 'internal',
    preheader: deadline
      ? `${n.company} ${n.name} 様から相談申込。${deadline} までに連絡してください`
      : `${n.company} ${n.name} 様が「${n.diagnosisTitle}」に回答しました`,
    blocks: [
      { type: 'badges', items: badges },
      {
        type: 'heading',
        text: n.consultationRequested
          ? `${n.diagnosisTitle}から相談申込がありました`
          : `${n.diagnosisTitle}に回答がありました`,
      },
      ...(deadline
        ? [
            {
              type: 'paragraph' as const,
              text: 'MQL判定を経ずに営業へ引き渡します。リードの内容を確認し、期限までにご連絡ください。',
            },
            {
              type: 'notice' as const,
              tone: 'danger' as const,
              title: '連絡期限',
              text: `${deadline}（土日を除く営業日）`,
            },
          ]
        : []),
      ...(n.identityUnverified
        ? [
            {
              type: 'notice' as const,
              tone: 'warning' as const,
              title: '本人確認が必要です',
              text: '既存リードと同じメールアドレスからの回答です。本人確認のうえ対応してください（リードの内容は変更していません）。',
            },
          ]
        : []),
      {
        type: 'facts',
        title: 'お客様',
        rows: [
          { label: '会社名', value: n.company },
          { label: '氏名', value: n.name },
          { label: 'メール', value: n.email },
        ],
      },
      { type: 'facts', title: '判定', rows: result },
      { type: 'button', label: 'リードを開く', url },
    ],
    footer: [
      'このメールは DiagnoLeads から自動で送信しています。',
      '心当たりがない場合は、組織の管理者にお問い合わせください。',
    ],
  });
  return { subject: title, ...rendered };
}

/**
 * Notify sales after a submission or a consultation request. Failures are logged and never
 * break the respondent's flow. Past the hourly limit of the organization nothing is sent (the
 * submission is saved all the same).
 */
export async function notifyDiagnosisSubmission(n: DiagnosisNotification): Promise<void> {
  if (
    !(await withinLimit(DIAGNOSIS_RATE_LIMITS.notificationsPerOrganization, n.organizationId, true))
  ) {
    return;
  }
  const { title, message } = buildDiagnosisSalesMessage(n);
  const data = {
    leadId: n.leadId,
    submissionId: n.submissionId,
    diagnosisId: n.diagnosisId,
    consultationRequested: n.consultationRequested,
    identityUnverified: n.identityUnverified,
  };

  const tasks: Promise<unknown>[] = [
    triggerWebhooks(n.organizationId, 'diagnostic.submitted', {
      ...data,
      email: n.email,
      company: n.company,
      name: n.name,
      score: n.leadScore,
      // mql = 関心あり（MQL）, mqlLevel as in the AX webhook (#139)
      mql: n.mqlQualified,
      mqlLevel: n.mqlLevel,
      resultType: n.resultTypeName,
    }),
  ];
  // A new lead is a lead.created too (#308), within the same limit as diagnostic.submitted
  if (n.leadCreated) tasks.push(sendLeadCreatedById(n.organizationId, n.leadId));

  // In-app: consultation requests and new leads (a repeat answer changes nothing on the lead)
  if (n.consultationRequested || n.leadCreated) {
    tasks.push(
      notifyOrganizationMembers(
        n.organizationId,
        n.consultationRequested ? 'consultation_requested' : 'lead_created',
        title,
        message,
        data
      )
    );
  }

  // Sales email for consultation requests, to the same address and within the same caps as the
  // AX diagnosis (the sending quota is shared with the sign-in emails)
  const salesEmail = env.AX_DIAGNOSIS_SALES_EMAIL;
  const salesRecipients = filterAllowedRecipients(
    salesEmail ? salesEmail.split(',').map((address) => address.trim()) : []
  );
  if (n.consultationRequested && salesRecipients.length === 0) {
    console.warn('Diagnosis consultation: no sales email sent (no allowed sales address is set)');
  }
  if (
    n.consultationRequested &&
    salesRecipients.length > 0 &&
    isEmailConfigured() &&
    (await withinLimit(AX_RATE_LIMITS.salesEmailPerOrganizationHourly, n.organizationId, false)) &&
    (await withinLimit(AX_RATE_LIMITS.salesEmailPerOrganization, n.organizationId, false))
  ) {
    tasks.push(sendEmail({ to: salesRecipients, ...buildDiagnosisSalesEmail(n) }));
  }

  const results = await Promise.allSettled(tasks);
  for (const r of results) {
    if (r.status === 'rejected') console.error('Diagnosis notification failed:', r.reason);
  }
}

/**
 * Count one against an organization limit. The first time it is exceeded, members get one
 * in-app notice. When the limit cannot be checked, `onError` decides (notifications go out,
 * emails do not).
 */
async function withinLimit(
  rule: { name: string; limit: number; windowMs: number },
  organizationId: string,
  onError: boolean
): Promise<boolean> {
  try {
    const quota = await consumeRateLimit(db, rule, organizationId);
    if (quota.allowed) return true;
    console.warn(`Diagnosis: limit ${rule.name} reached`);
    if (quota.count === rule.limit + 1) {
      await notifyOrganizationMembers(
        organizationId,
        'system',
        '【診断】通知を一時停止しました',
        `診断の通知が上限（${rule.limit}件）を超えたため、しばらく通知を止めています（リードとしては保存しています）。この間に届いた相談申込は、リード一覧（コンバージョンポイント：相談申込）で確認してください。`,
        { limit: rule.name }
      ).catch((error) => console.error('Diagnosis: limit notice failed:', error));
    }
    return false;
  } catch (error) {
    console.error(`Diagnosis: limit ${rule.name} check failed:`, error);
    return onError;
  }
}
