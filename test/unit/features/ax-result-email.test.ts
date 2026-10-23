/**
 * Mail to a respondent who asked for the AX diagnosis result (#154): a fixed confirmation mail
 * and a result mail built only from diagnosis-derived values.
 */
import { axSenderIdentity } from '@/lib/features/ax-site/sender-identity';
import type { AxMigrationPublicResult } from '@/lib/features/diagnostics/ax-migration/evaluate';
import {
  buildAxResultConfirmationEmail,
  buildAxResultEmail,
  withResultEmailUtm,
} from '@/lib/features/diagnostics/ax-migration/result-email';
import {
  AX_RESULT_EMAIL_CONSENT_KEYS,
  AX_RESULT_EMAIL_CONSENT_VERSION,
} from '@/lib/features/diagnostics/ax-migration/result-email-config';
import en from '@/locales/en/common.json';
import ja from '@/locales/ja/common.json';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const LOCALES = ['ja', 'en'] as const;
const CONFIRM_URL = 'https://app.example.com/ja/ax-diagnosis/email/confirm?token=abc123';
const UNSUBSCRIBE_URL = 'https://app.example.com/ja/unsubscribe?token=def456';
const PRIVACY_URL = 'https://example.com/privacy';
const REDIAGNOSE_URL = 'https://app.example.com/ja/ax-diagnosis?entry=lp#start';
const CONSULTATION_URL = 'https://bookings.example.com/book?service=ax';
const BANNED_JA = /\d+(円|%|か月|ヶ月|年)|削減/;

const RESULT: AxMigrationPublicResult = {
  platform: 'access',
  difficulty: { score: 55, level: 'medium' },
  urgency: { score: 80, level: 'high' },
  challenges: { primary: 'people', selected: ['people', 'cost'], scores: { people: 3, cost: 2, agility: 0, data: 0 } },
  reasons: { difficulty: ['access_vba'], urgency: ['access_support_ended'] },
  checkpoints: ['access_support'],
  accessPath: { path: 'web', reasons: ['check_unknowns'] },
  needsHearing: true,
  recommendation: 'consultation',
};
const DIAGNOSED_AT = new Date('2026-10-21T15:30:00Z'); // 2026-10-22 in Japan

function result(locale: 'ja' | 'en', consultationUrl: string | null = CONSULTATION_URL) {
  return buildAxResultEmail({
    locale,
    result: RESULT,
    links: { consultationUrl, rediagnoseUrl: REDIAGNOSE_URL },
    unsubscribeUrl: UNSUBSCRIBE_URL,
    diagnosedAt: DIAGNOSED_AT,
  });
}

function confirmation(locale: 'ja' | 'en') {
  return buildAxResultConfirmationEmail({
    locale,
    confirmUrl: CONFIRM_URL,
    unsubscribeUrl: UNSUBSCRIBE_URL,
  });
}

/** The text a reader sees: tags and their inline styles (width:100%) left out */
function visible(html: string): string {
  return html.replace(/<[^>]*>/g, ' ');
}

function hrefs(html: string): string[] {
  return [...html.matchAll(/href="([^"]+)"/g)].map((match) => (match[1] ?? '').replace(/&amp;/g, '&'));
}

describe('AX result mail', () => {
  const saved = process.env.NEXT_PUBLIC_AX_PRIVACY_POLICY_URL;
  beforeEach(() => {
    process.env.NEXT_PUBLIC_AX_PRIVACY_POLICY_URL = PRIVACY_URL;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.NEXT_PUBLIC_AX_PRIVACY_POLICY_URL;
    else process.env.NEXT_PUBLIC_AX_PRIVACY_POLICY_URL = saved;
  });

  describe('sender identity', () => {
    it.each(LOCALES)('takes the company, address and contact from the AX site (%s)', (locale) => {
      const messages = locale === 'ja' ? ja : en;
      const sender = axSenderIdentity(locale);
      expect(sender.operatorName).toBe(messages.axSite.footer.companyName);
      expect(sender.address).toBe(messages.axSite.footer.address);
      expect(sender.email).toBe('dx-agency@sas-com.com');
      expect(sender.replyTo).toBe(sender.email);
      expect(sender.privacyPolicyUrl).toBe(PRIVACY_URL);
      // The site footer names the same company
      expect(messages.axSite.footer.operator).toContain(sender.operatorName);
    });

    it('has no privacy policy link while the URL is not set', () => {
      delete process.env.NEXT_PUBLIC_AX_PRIVACY_POLICY_URL;
      expect(axSenderIdentity('ja').privacyPolicyUrl).toBeNull();
      const mail = confirmation('ja');
      expect(mail.text).not.toContain('個人情報保護方針');
      expect(mail.text).toContain(`配信停止：${UNSUBSCRIBE_URL}`);
    });
  });

  describe('confirmation mail', () => {
    it.each(LOCALES)('has a fixed subject and the confirmation button (%s)', (locale) => {
      const mail = confirmation(locale);
      const messages = locale === 'ja' ? ja : en;
      expect(mail.subject).toBe(messages.axDiagnosis.resultEmail.confirm.subject);
      expect(hrefs(mail.html)[0]).toBe(CONFIRM_URL);
      expect(mail.text).toContain(CONFIRM_URL);
      expect(mail.text).toContain('72');
    });

    it.each(LOCALES)('links unsubscribe and the privacy policy in html and text (%s)', (locale) => {
      const mail = confirmation(locale);
      expect(hrefs(mail.html)).toEqual(expect.arrayContaining([UNSUBSCRIBE_URL, PRIVACY_URL]));
      expect(mail.text).toContain(UNSUBSCRIBE_URL);
      expect(mail.text).toContain(PRIVACY_URL);
      expect(mail.text).toContain('dx-agency@sas-com.com');
    });

    it('is the same text for every request: only the links differ', () => {
      const a = confirmation('ja');
      const b = buildAxResultConfirmationEmail({
        locale: 'ja',
        confirmUrl: 'https://app.example.com/other?token=zzz',
        unsubscribeUrl: 'https://app.example.com/u?token=yyy',
      });
      const strip = (text: string) => text.replace(/https:\/\/\S+/g, 'URL');
      expect(strip(a.text)).toBe(strip(b.text));
      expect(a.subject).toBe(b.subject);
    });

    it('says nothing about periods, costs or reductions in Japanese', () => {
      const mail = confirmation('ja');
      expect(mail.text).not.toMatch(BANNED_JA);
      expect(visible(mail.html)).not.toMatch(BANNED_JA);
    });
  });

  describe('result mail', () => {
    it.each(LOCALES)('has a fixed subject and shows the diagnosis values (%s)', (locale) => {
      const mail = result(locale);
      const messages = locale === 'ja' ? ja : en;
      const r = messages.axDiagnosis.result;
      expect(mail.subject).toBe(messages.axDiagnosis.resultEmail.result.subject);
      for (const value of [
        messages.axDiagnosis.platforms.access,
        r.difficultyText.medium,
        r.urgencyText.high,
        r.challenges.people.title,
        r.accessPath.paths.web.title,
        messages.axDiagnosis.resultEmail.result.rediagnoseHint,
        messages.axDiagnosis.resultEmail.sender.greeting,
      ]) {
        expect(mail.text).toContain(value);
      }
    });

    it('writes the date with digits and slashes in Japanese', () => {
      expect(result('ja').text).toContain('診断日：2026/10/22');
      expect(result('en').text).toContain('October 22, 2026');
    });

    it('leaves out the hint, the path and the challenge title when they do not apply', () => {
      const mail = buildAxResultEmail({
        locale: 'ja',
        result: {
          ...RESULT,
          platform: 'as400',
          accessPath: null,
          needsHearing: false,
          challenges: { ...RESULT.challenges, primary: null },
        },
        links: { rediagnoseUrl: REDIAGNOSE_URL },
        unsubscribeUrl: UNSUBSCRIBE_URL,
        diagnosedAt: DIAGNOSED_AT,
      });
      expect(mail.text).not.toContain(ja.axDiagnosis.resultEmail.result.rediagnoseHint);
      expect(mail.text).not.toContain(ja.axDiagnosis.result.accessPath.title);
      expect(mail.text).toContain(ja.axDiagnosis.result.noPrimaryChallenge.title);
      expect(mail.text).toContain(ja.axDiagnosis.platforms.as400);
    });

    it('says nothing about periods, costs or reductions in Japanese', () => {
      for (const level of ['low', 'medium', 'high'] as const) {
        for (const primary of ['people', 'cost', 'agility', 'data', null] as const) {
          const mail = buildAxResultEmail({
            locale: 'ja',
            result: {
              ...RESULT,
              difficulty: { score: 0, level },
              urgency: { score: 0, level },
              challenges: { ...RESULT.challenges, primary },
            },
            links: { consultationUrl: CONSULTATION_URL, rediagnoseUrl: REDIAGNOSE_URL },
            unsubscribeUrl: UNSUBSCRIBE_URL,
            diagnosedAt: DIAGNOSED_AT,
          });
          expect(mail.text).not.toMatch(BANNED_JA);
          expect(visible(mail.html)).not.toMatch(BANNED_JA);
        }
      }
    });

    it('leaves out the problem and solution text of the challenge (it mentions budgets)', () => {
      const mail = result('ja');
      expect(mail.text).not.toContain(ja.axDiagnosis.result.challenges.people.problem);
      expect(mail.text).not.toContain(ja.axDiagnosis.result.disclaimer);
    });

    it.each(LOCALES)('links unsubscribe and the privacy policy in html and text (%s)', (locale) => {
      const mail = result(locale);
      expect(hrefs(mail.html)).toEqual(expect.arrayContaining([UNSUBSCRIBE_URL, PRIVACY_URL]));
      expect(mail.text).toContain(UNSUBSCRIBE_URL);
      expect(mail.text).toContain(PRIVACY_URL);
    });

    it.each(LOCALES)('adds campaign parameters to both buttons and keeps the query (%s)', (locale) => {
      const links = hrefs(result(locale).html).map((href) => new URL(href));
      const consultation = links.find((url) => url.hostname === 'bookings.example.com');
      const rediagnosis = links.find((url) => url.pathname === '/ja/ax-diagnosis');
      expect(consultation?.searchParams.get('service')).toBe('ax');
      expect(consultation?.searchParams.get('utm_content')).toBe('consultation');
      expect(rediagnosis?.searchParams.get('entry')).toBe('lp');
      expect(rediagnosis?.hash).toBe('#start');
      for (const url of [consultation, rediagnosis]) {
        expect(url?.searchParams.get('utm_source')).toBe('result_email');
        expect(url?.searchParams.get('utm_medium')).toBe('email');
        expect(url?.searchParams.get('utm_campaign')).toBe('ax_result');
      }
      expect(rediagnosis?.searchParams.get('utm_content')).toBe('rediagnosis');
    });

    it.each([null, undefined])('has no consultation button when the link is %s', (consultationUrl) => {
      const mail = buildAxResultEmail({
        locale: 'ja',
        result: RESULT,
        links: { consultationUrl, rediagnoseUrl: REDIAGNOSE_URL },
        unsubscribeUrl: UNSUBSCRIBE_URL,
        diagnosedAt: DIAGNOSED_AT,
      });
      expect(mail.text).not.toContain(ja.axDiagnosis.resultEmail.result.consultationButton);
      expect(mail.text).not.toContain(ja.axDiagnosis.resultEmail.result.consultationLead);
      expect(mail.html).not.toContain('utm_content=consultation');
      expect(mail.text).toContain(ja.axDiagnosis.resultEmail.result.rediagnoseButton);
    });
  });

  describe('withResultEmailUtm', () => {
    it('replaces campaign parameters already on the link and keeps the rest', () => {
      const url = new URL(
        withResultEmailUtm('https://example.com/p?utm_source=lp&a=1&a=2', 'rediagnosis')
      );
      expect(url.searchParams.getAll('utm_source')).toEqual(['result_email']);
      expect(url.searchParams.getAll('a')).toEqual(['1', '2']);
    });

    it('returns a link that does not parse unchanged', () => {
      expect(withResultEmailUtm('not a url', 'consultation')).toBe('not a url');
    });
  });

  it('accepts no respondent-supplied strings', () => {
    buildAxResultConfirmationEmail({
      locale: 'ja',
      confirmUrl: CONFIRM_URL,
      unsubscribeUrl: UNSUBSCRIBE_URL,
      // @ts-expect-error the builders take no company, name or free text
      company: '<b>架空商事</b>',
    });
    buildAxResultEmail({
      locale: 'ja',
      result: RESULT,
      links: { rediagnoseUrl: REDIAGNOSE_URL },
      unsubscribeUrl: UNSUBSCRIBE_URL,
      diagnosedAt: DIAGNOSED_AT,
      // @ts-expect-error the builders take no company, name or free text
      leadName: '架空 太郎',
    });
    expect(true).toBe(true);
  });

  it('exports the consent version and text keys that exist in both locales', () => {
    expect(AX_RESULT_EMAIL_CONSENT_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    for (const messages of [ja, en]) {
      for (const key of Object.values(AX_RESULT_EMAIL_CONSENT_KEYS)) {
        const value = key
          .split('.')
          .reduce<unknown>(
            (node, part) =>
              node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined,
            messages
          );
        expect(typeof value).toBe('string');
      }
    }
  });

  // A mail without a working confirm or unsubscribe link is never built (#154 review)
  it('refuses to build a mail whose confirm or unsubscribe link is not https', () => {
    expect(() =>
      buildAxResultConfirmationEmail({
        locale: 'ja',
        confirmUrl: 'http://app.example.com/confirm',
        unsubscribeUrl: UNSUBSCRIBE_URL,
      })
    ).toThrow(/confirm link/);
    expect(() =>
      buildAxResultConfirmationEmail({
        locale: 'ja',
        confirmUrl: CONFIRM_URL,
        unsubscribeUrl: 'javascript:alert(1)',
      })
    ).toThrow(/unsubscribe link/);
  });

  it('returns the sender department as the reply-to address', () => {
    const mail = buildAxResultConfirmationEmail({
      locale: 'ja',
      confirmUrl: CONFIRM_URL,
      unsubscribeUrl: UNSUBSCRIBE_URL,
    });
    expect(mail.replyTo).toMatch(/@/);
  });
});
