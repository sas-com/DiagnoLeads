import { createHash } from 'node:crypto';
import ja from '@/locales/ja/common.json';
/**
 * 「Webに移すときの確認シート」 (#843): what an information-systems department checks when a
 * system used only in-house moves to the web, for its review. Handed out as a PDF from the
 * diagnosis result (information offers, #153), and drawn by scripts/generate-web-checklist.ts.
 *
 * The agreed sentences are the landing page's own (locales), so the sheet says nothing the page
 * does not (#837): what to decide, the upkeep, the data and the certifications. Only the way to use
 * the sheet and the questions to check are written here, as questions and never as promises: no
 * scope, hours or cost (#296), and no arranging of a third-party test (2026-10-25-access-consult-
 * open-points). Japanese only: the sheet is for reviewers in Japan.
 */
import { AX_CONTACT } from './contact';

/** Where the PDF is, in the repository and on the site (outside the language paths) */
export const WEB_CHECKLIST_FILE = 'public/documents/ax-web-checklist.pdf';
export const WEB_CHECKLIST_PATH = '/documents/ax-web-checklist.pdf';
/**
 * The digest of the sheet the PDF was printed from, written with it: the test fails when the
 * sheet or the landing page sentences change and the PDF is not printed again
 */
export const WEB_CHECKLIST_DIGEST_FILE = 'lib/features/ax-site/web-checklist-pdf.json';
/**
 * The company site, as linked from the AX site footer (AX_SITE_LINKS.operator): a reviewer reads
 * the company's own address better than the address the diagnosis is served from today
 */
export const WEB_CHECKLIST_COMPANY_SITE = 'https://sas-com.com/';

export interface WebChecklistItem {
  title: string;
  /** Questions to decide, each with a box to tick */
  checks: string[];
  /** Sentences of the landing page under the checks */
  notes: string[];
}

export interface WebChecklistSection {
  heading: string;
  lead?: string;
  items: WebChecklistItem[];
}

export interface WebChecklist {
  /** Who the sheet is for, above the title */
  audience: string;
  title: string;
  /** The landing page's line for the reviewers: "閉じて守る、から、決めて守るへ" */
  subtitle: string;
  /** Change it when the text changes */
  edition: string;
  /** The landing page's headline on the web, then its lead */
  intro: { headline: string; body: string };
  howToUse: { heading: string; lines: string[] };
  sections: WebChecklistSection[];
  certifications: { heading: string; items: { title: string; body: string }[] };
  closing: string[];
  footer: {
    operator: string;
    address: string;
    contact: string;
    hours: string;
    companySite: string;
  };
}

const site = ja.axSite;
const decide = site.webScope.decide.items;
const faq = site.faq.items;

/** A landing page answer without its first sentence, the "はい。" or "使われません。" */
function withoutReply(answer: string): string {
  return answer.replace(/^[^。]*。/, '');
}

export function webChecklist(): WebChecklist {
  return {
    audience: '情報システム部門の審査用',
    title: 'Webに移すときの確認シート',
    subtitle: site.webScope.eyebrow,
    edition: '2026年11月版',
    intro: { headline: site.webScope.title, body: site.webScope.lead },
    howToUse: {
      heading: 'このシートの使い方',
      lines: [
        '説明を受けたいことに印を付け、御社の決まりは右の欄にお書きください。社内での検討にも使えます。',
        'ご相談のときにお見せください。印を付けた項目に沿って、御社の審査の様式があればそれに合わせて、ご説明します。',
        // The last sentence of the landing page's FAQ on the review (faq.itReview)
        '内容に応じて、エンジニアも同席します。',
      ],
    },
    sections: [
      {
        heading: site.webScope.decide.title,
        lead: site.webScope.decide.lead,
        items: [
          {
            title: decide.reach.title,
            checks: [
              '社内のネットワークからだけ使うか、社外（在宅・ほかの拠点）からも使うか',
              '社外から使うときに、つながってよい人と端末の範囲',
              'システムを置く場所と、それについての御社の決まり',
            ],
            notes: [faq.internalOnly.a],
          },
          {
            title: decide.login.title,
            checks: [
              '会社のアカウントでログインするか',
              '本人の確認を重ねる仕組み（多要素認証）を使うか',
              '異動や退職のときに、アカウントを止める手順',
            ],
            notes: [],
          },
          {
            title: decide.control.title,
            checks: [
              '誰に、何を許すか（見る・入力する・変える・消す）',
              '誰がいつ何をしたかを、何まで、どれだけの期間記録するか',
              'バックアップの取り方と、戻すときの手順',
            ],
            notes: [],
          },
          {
            title: decide.upkeep.title,
            // As the column on moving Access to the web puts it (columns/access-web-security.ts)
            checks: [
              '使っている部品（言語・ライブラリ・OS など）と版、サポートが終わる時期を、誰が記録するか',
              '弱点の知らせを、誰が見張るか',
              '直す作業を、御社と当社のどちらが、どこまで受け持つか',
              '直すときの連絡のしかたと、直したあとの確かめ方',
              '使い始める前に、第三者による脆弱性診断を受けるか',
            ],
            notes: [decide.upkeep.body],
          },
        ],
      },
      {
        heading: 'データの扱い',
        items: [
          {
            title: '入っている情報と、移行の作業で使うデータ',
            checks: [
              'システムに入っている情報の種類（個人情報・社外秘など）',
              '移行の作業で使うデータと、お預かりするファイルの範囲',
              'お預かりするファイルの置き場所と、保管の期間・消し方',
              '秘密保持の契約など、取り交わす書面が要るか',
              // Asked in the first hearing too (decision 2026-10-17-hearing-ai-policy)
              '仕様書やソースコードを、AI で解析してよいか（AI の利用についての、御社の決まり）',
            ],
            notes: [withoutReply(faq.personalData.a), withoutReply(faq.data.a)],
          },
        ],
      },
    ],
    certifications: {
      heading: '当社の認証',
      items: [site.trust.items.privacyMark, site.trust.items.isms],
    },
    closing: [
      'どの項目も、御社の決まりを伺ってから、進め方を決めるときに一緒に決めます。',
      // The last sentence of the landing page's closing call (finalCta.lead)
      'ご相談はお電話・メールでも承ります。',
    ],
    footer: {
      operator: site.footer.operator,
      address: site.footer.address,
      contact: `電話 ${AX_CONTACT.phone}　メール ${AX_CONTACT.email}`,
      hours: site.finalCta.contact.hours,
      companySite: `${site.footer.company}：${WEB_CHECKLIST_COMPANY_SITE}`,
    },
  };
}

/** Changes with any text of the sheet */
export function webChecklistDigest(sheet: WebChecklist): string {
  return createHash('sha256').update(JSON.stringify(sheet)).digest('hex');
}

/** Every text of the sheet, for the copy checks */
export function webChecklistStrings(sheet: WebChecklist = webChecklist()): string[] {
  return [
    sheet.audience,
    sheet.title,
    sheet.subtitle,
    sheet.intro.headline,
    sheet.intro.body,
    sheet.howToUse.heading,
    ...sheet.howToUse.lines,
    ...sheet.sections.flatMap((section) => [
      section.heading,
      ...(section.lead ? [section.lead] : []),
      ...section.items.flatMap((item) => [item.title, ...item.checks, ...item.notes]),
    ]),
    sheet.certifications.heading,
    ...sheet.certifications.items.flatMap((item) => [item.title, item.body]),
    ...sheet.closing,
  ];
}
