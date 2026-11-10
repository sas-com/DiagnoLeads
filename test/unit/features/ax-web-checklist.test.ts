import { readFileSync } from 'node:fs';
import path from 'node:path';
import { AX_SITE_LINKS } from '@/components/features/ax-site/site-config';
import {
  WEB_CHECKLIST_COMPANY_SITE,
  WEB_CHECKLIST_DIGEST_FILE,
  WEB_CHECKLIST_FILE,
  WEB_CHECKLIST_PATH,
  webChecklist,
  webChecklistDigest,
  webChecklistStrings,
} from '@/lib/features/ax-site/web-checklist';
import { shouldSkipI18nMiddleware } from '@/lib/i18n/middleware';
import en from '@/locales/en/common.json';
import ja from '@/locales/ja/common.json';
import { describe, expect, it, vi } from 'vitest';

// The i18n middleware loads next-intl's, which needs next/server (as in its own test)
vi.mock('next-intl/middleware', () => ({ default: vi.fn(() => vi.fn()) }));

const sheet = webChecklist();
const texts = webChecklistStrings(sheet);
const site = ja.axSite;
const faq = site.faq.items;

describe('Webに移すときの確認シート (#843)', () => {
  it('says what the landing page says on what to decide, the upkeep, the data and the certifications', () => {
    for (const sentence of [
      site.webScope.eyebrow,
      site.webScope.title,
      site.webScope.lead,
      site.webScope.decide.title,
      site.webScope.decide.lead,
      ...Object.values(site.webScope.decide.items).map((item) => item.title),
      site.webScope.decide.items.upkeep.body,
      site.trust.items.privacyMark.body,
      site.trust.items.isms.body,
      faq.internalOnly.a,
    ]) {
      expect(texts).toContain(sentence);
    }
  });

  it('copies its other agreed sentences from the landing page word for word', () => {
    const [personal, data] = sheet.sections[1].items[0].notes;
    expect(faq.itReview.a).toContain(sheet.howToUse.lines[2]);
    expect(site.finalCta.lead.endsWith(sheet.closing[1])).toBe(true);
    expect(faq.personalData.a.endsWith(personal)).toBe(true);
    expect(faq.data.a.endsWith(data)).toBe(true);
  });

  it('promises no scope, hours, cost, arranging or safety (#296)', () => {
    const promises =
      /何日以内|時間以内|24時間|即日|すぐに|必ず|無料|費用|保証|万全|手配|安全になります|安全です|安心です/;
    expect(texts.filter((text) => promises.test(text))).toEqual([]);
    // The only sentence about safety is the landing page's answer on AI and the data
    const safety = texts.flatMap((text) => text.match(/[^。]*安全[^。]*。?/g) ?? []);
    expect(safety).toEqual([
      'お預かりした仕様書・ソースコードなどは、学習データとして利用されない安全な環境で処理します。',
    ]);
  });

  it('gives the contact of the landing page and the company site, not the address of the service', () => {
    expect(sheet.footer.operator).toBe(site.footer.operator);
    expect(sheet.footer.address).toBe(site.footer.address);
    expect(sheet.footer.hours).toBe(site.finalCta.contact.hours);
    expect(WEB_CHECKLIST_COMPANY_SITE).toBe(AX_SITE_LINKS.operator);
    expect(sheet.footer.companySite.endsWith(WEB_CHECKLIST_COMPANY_SITE)).toBe(true);
    expect(JSON.stringify(sheet)).not.toContain('vercel.app');
  });

  it('is in the repository as a PDF printed from the sheet as it is now', () => {
    const pdf = readFileSync(path.join(process.cwd(), WEB_CHECKLIST_FILE));
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    // Run `bun scripts/generate-web-checklist.ts` after changing the sheet or the sentences
    const printed = JSON.parse(
      readFileSync(path.join(process.cwd(), WEB_CHECKLIST_DIGEST_FILE), 'utf8')
    ) as { sha256: string };
    expect(printed.sha256).toBe(webChecklistDigest(sheet));
  });

  // Owner's decision on #843 (2026-11-08): the review FAQ of both pages points to the result
  // page, where the sheet is offered; a request straight from the page waits for #899
  it('is pointed to from the review FAQ of both landing pages', () => {
    for (const answer of [faq.itReview.a, ja.axAccess.faq.items.itReview.a]) {
      expect(answer).toContain('確認シート');
      expect(answer).toContain('無料Web診断の結果画面');
    }
    for (const answer of [en.axSite.faq.items.itReview.a, en.axAccess.faq.items.itReview.a]) {
      expect(answer).toContain('checklist');
      expect(answer).toContain('in Japanese');
    }
  });

  it('is served from public outside the language paths', () => {
    expect(WEB_CHECKLIST_FILE).toBe(`public${WEB_CHECKLIST_PATH}`);
    expect(shouldSkipI18nMiddleware(WEB_CHECKLIST_PATH)).toBe(true);
  });
});
