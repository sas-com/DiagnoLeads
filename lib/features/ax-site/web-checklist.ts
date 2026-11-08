import { createHash } from 'node:crypto';
import ja from '@/locales/ja/common.json';
/**
 * 「Web 化のときの確認項目シート」 (#843): what an information-systems department checks when a
 * system used only in-house moves to the web, for its review. Handed out as a PDF from the
 * diagnosis result (information offers, #153), and drawn by scripts/generate-web-checklist.ts.
 *
 * The agreed sentences are the landing page's own (locales), so the sheet says nothing the page
 * does not (#837): what to decide, the upkeep, the data and the certifications. Only the way to use
 * the sheet and the questions to check are written here. No scope, hours or cost (#296).
 * Japanese only: the sheet is for reviewers in Japan.
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
/** The site printed on the sheet */
export const WEB_CHECKLIST_SITE_URL = 'https://diagnoleads-v2.vercel.app';

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
  title: string;
  subtitle: string;
  edition: string;
  /** The landing page's headline on the web, then its lead */
  intro: { headline: string; body: string };
  howToUse: string[];
  sections: WebChecklistSection[];
  certifications: { heading: string; items: { title: string; body: string }[] };
  closing: string[];
  footer: { operator: string; address: string; contact: string; site: string };
}

const site = ja.axSite;
const decide = site.webScope.decide.items;
const faq = site.faq.items;

/** A landing page answer without its first sentence, the "はい。" or "使われません。" */
function withoutReply(answer: string): string {
  return answer.replace(/^[^。]*。/, '');
}

export function webChecklist(siteUrl: string): WebChecklist {
  return {
    title: 'Web 化のときの確認項目シート',
    subtitle:
      '社内で使ってきたシステムを Web システムに移すときに、情報システム部門の審査で確かめる項目',
    edition: '2026年11月版',
    intro: { headline: site.webScope.title, body: site.webScope.lead },
    howToUse: [
      '審査で確かめたい項目に印を付けて、ご相談のときにお見せください。印を付けた項目に沿ってご説明します。',
      // The last sentence of the landing page's FAQ on the review (faq.itReview)
      '内容に応じて、エンジニアも同席します。',
    ],
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
              'ネットワークとクラウドの利用についての、御社の決まり',
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
              '誰に、何を許すか（見る・入力する・直す・消す）',
              '誰がいつ何をしたかを、何まで、どれだけの期間記録するか',
              'バックアップの取り方と、戻すときの手順',
            ],
            notes: [],
          },
          {
            title: decide.upkeep.title,
            checks: [
              '使っているソフトウェアの弱点の知らせを、誰が見張るか',
              '直す作業を、御社と当社のどちらが、どこまで受け持つか',
              '直すときの連絡のしかたと、直したあとの確かめ方',
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
              'お預かりするファイルの置き場所・期間・消し方と、秘密保持の契約',
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
      // A sentence of the landing page's FAQ on web security (faq.webSecurity)
      'どこまでお任せいただくかは、進め方とあわせてご相談します。',
    ],
    footer: {
      operator: site.footer.operator,
      address: site.footer.address,
      contact: `電話 ${AX_CONTACT.phone}　メール ${AX_CONTACT.email}`,
      site: `${siteUrl}/ja/ax-migration`,
    },
  };
}

/** Changes with any text of the sheet, its address included */
export function webChecklistDigest(sheet: WebChecklist): string {
  return createHash('sha256').update(JSON.stringify(sheet)).digest('hex');
}

/** Every text of the sheet, for the copy checks */
export function webChecklistStrings(
  sheet: WebChecklist = webChecklist(WEB_CHECKLIST_SITE_URL)
): string[] {
  return [
    sheet.title,
    sheet.subtitle,
    sheet.intro.headline,
    sheet.intro.body,
    ...sheet.howToUse,
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
