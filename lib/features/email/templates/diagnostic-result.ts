/**
 * Diagnostic Result Email Template
 *
 * Email with the diagnostic result for the respondent of the legacy form (off by default),
 * laid out with the shared email blocks (#285)
 */
import { type EmailFact, type EmailTone, renderEmail } from '@/lib/email/templates/render';

export interface DiagnosticResultEmailData {
  name: string;
  company: string;
  email: string;
  score: number;
  industry?: string;
  employeeCount?: string;
  timeline?: string;
  budget?: string;
  challenge?: string;
  goal?: string;
  locale?: 'en' | 'ja';
}

/**
 * Tone of the score badge
 */
function getScoreTone(score: number): EmailTone {
  if (score >= 70) return 'success';
  if (score >= 40) return 'warning';
  return 'danger';
}

/**
 * Get score label based on value
 */
function getScoreLabel(score: number, locale: 'en' | 'ja'): string {
  if (locale === 'ja') {
    if (score >= 70) return '高い可能性';
    if (score >= 40) return '中程度の可能性';
    return '要フォローアップ';
  }
  if (score >= 70) return 'High Potential';
  if (score >= 40) return 'Medium Potential';
  return 'Needs Follow-up';
}

/**
 * Get translations for the email
 */
function getTranslations(locale: 'en' | 'ja') {
  return locale === 'ja'
    ? {
        subject: 'あなたの診断結果が届きました',
        greeting: (name: string) => `${name}様`,
        intro:
          'この度は診断フォームをご送信いただき、誠にありがとうございます。以下があなたの診断結果です。',
        scoreTitle: 'あなたのスコア',
        profileTitle: 'ビジネスプロフィール',
        company: '会社名',
        industry: '業種',
        employeeCount: '従業員数',
        timeline: '導入予定時期',
        budget: '予算',
        challenge: '現在の課題',
        goal: '目標',
        nextSteps: '次のステップ',
        nextStepsContent:
          '当社の専門家がまもなくご連絡いたします。お急ぎの場合は、以下の方法でお問い合わせください：\nメール: contact@diagnoleads.com\n電話: 03-1234-5678',
        footer: 'ご質問がございましたら、お気軽にお問い合わせください。',
        signature: 'DiagnoLeadsチーム',
      }
    : {
        subject: 'Your Diagnostic Results Are Ready',
        greeting: (name: string) => `Hello ${name},`,
        intro: 'Thank you for completing our diagnostic form. Below are your personalized results.',
        scoreTitle: 'Your Score',
        profileTitle: 'Business Profile',
        company: 'Company',
        industry: 'Industry',
        employeeCount: 'Company Size',
        timeline: 'Timeline',
        budget: 'Budget',
        challenge: 'Current Challenge',
        goal: 'Primary Goal',
        nextSteps: 'Next Steps',
        nextStepsContent:
          'One of our specialists will be in touch with you shortly. In the meantime, feel free to reach out:\nEmail: contact@diagnoleads.com\nPhone: +1 (555) 123-4567',
        footer: "If you have any questions, please don't hesitate to contact us.",
        signature: 'The DiagnoLeads Team',
      };
}

/**
 * Generate the diagnostic result email (HTML and plain text)
 */
export function generateDiagnosticResultEmail(data: DiagnosticResultEmailData): {
  subject: string;
  html: string;
  text: string;
} {
  const locale = data.locale || 'en';
  const t = getTranslations(locale);
  const scoreLabel = getScoreLabel(data.score, locale);

  const profile: EmailFact[] = (
    [
      [t.company, data.company],
      [t.industry, data.industry],
      [t.employeeCount, data.employeeCount],
      [t.timeline, data.timeline],
      [t.budget, data.budget],
      [t.challenge, data.challenge],
      [t.goal, data.goal],
    ] as const
  ).flatMap(([label, value]) => (value ? [{ label, value }] : []));

  const rendered = renderEmail({
    theme: 'customer',
    lang: locale,
    brand: 'DiagnoLeads',
    preheader: `${t.scoreTitle}: ${data.score} (${scoreLabel})`,
    blocks: [
      { type: 'paragraph', text: t.greeting(data.name || data.email) },
      { type: 'paragraph', text: t.intro },
      { type: 'heading', text: `${t.scoreTitle}: ${data.score}` },
      { type: 'badges', items: [{ label: scoreLabel, tone: getScoreTone(data.score) }] },
      { type: 'facts', title: t.profileTitle, rows: profile },
      { type: 'notice', tone: 'info', title: t.nextSteps, text: t.nextStepsContent },
      { type: 'paragraph', text: t.footer },
      { type: 'paragraph', text: t.signature },
    ],
    footer: [`© ${new Date().getFullYear()} DiagnoLeads. All rights reserved.`],
  });

  return { subject: t.subject, ...rendered };
}
