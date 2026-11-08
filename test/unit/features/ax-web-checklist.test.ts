import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  WEB_CHECKLIST_DIGEST_FILE,
  WEB_CHECKLIST_FILE,
  WEB_CHECKLIST_PATH,
  WEB_CHECKLIST_SITE_URL,
  webChecklist,
  webChecklistDigest,
  webChecklistStrings,
} from '@/lib/features/ax-site/web-checklist';
import { shouldSkipI18nMiddleware } from '@/lib/i18n/middleware';
import ja from '@/locales/ja/common.json';
import { describe, expect, it, vi } from 'vitest';

// The i18n middleware loads next-intl's, which needs next/server (as in its own test)
vi.mock('next-intl/middleware', () => ({ default: vi.fn(() => vi.fn()) }));

const sheet = webChecklist(WEB_CHECKLIST_SITE_URL);
const texts = webChecklistStrings(sheet);
const site = ja.axSite;
const faq = site.faq.items;

describe('Web 化のときの確認項目シート (#843)', () => {
  it('says what the landing page says on what to decide, the upkeep, the data and the certifications', () => {
    for (const sentence of [
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
    expect(faq.itReview.a.endsWith(sheet.howToUse[1])).toBe(true);
    expect(faq.webSecurity.a).toContain(sheet.closing[1]);
    expect(faq.personalData.a.endsWith(personal)).toBe(true);
    expect(faq.data.a.endsWith(data)).toBe(true);
  });

  it('promises no scope, hours, cost or safety (#296)', () => {
    const promises =
      /何日以内|時間以内|24時間|即日|すぐに|必ず|無料|費用|保証|万全|安全になります|安全です|安心です/;
    expect(texts.filter((text) => promises.test(text))).toEqual([]);
    // The only sentence about safety is the landing page's answer on AI and the data
    const safety = texts.flatMap((text) => text.match(/[^。]*安全[^。]*。?/g) ?? []);
    expect(safety).toEqual([
      'お預かりした仕様書・ソースコードなどは、学習データとして利用されない安全な環境で処理します。',
    ]);
  });

  it('prints the public site and the contact of the landing page footer', () => {
    expect(sheet.footer.site).toBe(`${WEB_CHECKLIST_SITE_URL}/ja/ax-migration`);
    expect(sheet.footer.site.startsWith('https://')).toBe(true);
    expect(sheet.footer.operator).toBe(site.footer.operator);
    expect(sheet.footer.address).toBe(site.footer.address);
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

  it('is served from public outside the language paths', () => {
    expect(WEB_CHECKLIST_FILE).toBe(`public${WEB_CHECKLIST_PATH}`);
    expect(shouldSkipI18nMiddleware(WEB_CHECKLIST_PATH)).toBe(true);
  });
});
