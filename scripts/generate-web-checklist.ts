/**
 * The 「Web 化のときの確認項目シート」 PDF (#843): public/documents/ax-web-checklist.pdf, handed
 * out from the AX diagnosis result as a document of the information offers (#153). Its text is in
 * lib/features/ax-site/web-checklist.ts, mostly the landing page's own sentences.
 *
 * Usage: bun scripts/generate-web-checklist.ts
 *
 * Like the column thumbnails (scripts/generate-column-thumbnails.ts), the sheet is an HTML page
 * printed by headless Chromium (Playwright); only the PDF is committed. Run it again after
 * changing the sheet or the landing page sentences it uses. CHROMIUM_EXECUTABLE_PATH points
 * Playwright at another Chromium when its own is not installed.
 *
 * The font is the static Noto Sans JP of the PDF reports (public/fonts), embedded as a subset of
 * TrueType. The variable Noto Sans JP of Google Fonts goes into a PDF as drawn glyphs (Type 3),
 * heavier (0.8 MB for two pages) and less crisp. That file has the regular weight only, so the
 * headings are drawn bold from it.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  WEB_CHECKLIST_DIGEST_FILE,
  WEB_CHECKLIST_FILE,
  type WebChecklist,
  type WebChecklistItem,
  webChecklist,
  webChecklistDigest,
} from '@/lib/features/ax-site/web-checklist';
import { PDF_FONT_FILE_NAME } from '@/lib/features/reports/pdf-font';
import { chromium } from '@playwright/test';

/** The font as a data URL: the page is set from a string, so it has no address to load files from */
async function fontFace(): Promise<string> {
  const font = await readFile(path.join(process.cwd(), 'public', 'fonts', PDF_FONT_FILE_NAME));
  return `@font-face { font-family: 'Noto Sans JP'; font-weight: 400; src: url(data:font/ttf;base64,${font.toString('base64')}) format('truetype'); }`;
}

/** Colors of the AX site (app/globals.css): white text only on the dark teal */
const COLORS = {
  teal: '#087270',
  deep: '#033b3a',
  mist: '#f3f3f3',
  ink: '#333333',
  line: '#b7c9c8',
} as const;

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function itemRow(item: WebChecklistItem): string {
  const checks = item.checks
    .map((check) => `<li><span class="box" aria-hidden="true"></span>${escapeHtml(check)}</li>`)
    .join('');
  const notes = item.notes.map((note) => `<p class="note">${escapeHtml(note)}</p>`).join('');
  return `<tr>
    <th scope="row">${escapeHtml(item.title)}</th>
    <td><ul class="checks">${checks}</ul>${notes}</td>
    <td class="memo"></td>
  </tr>`;
}

function sheetHtml(sheet: WebChecklist): string {
  const sections = sheet.sections
    .map(
      (section) => `<section>
      <h2>${escapeHtml(section.heading)}</h2>
      ${section.lead ? `<p class="lead">${escapeHtml(section.lead)}</p>` : ''}
      <table>
        <thead><tr><th scope="col">項目</th><th scope="col">確かめること</th><th scope="col">御社の決まり・メモ</th></tr></thead>
        <tbody>${section.items.map(itemRow).join('')}</tbody>
      </table>
    </section>`
    )
    .join('');
  const certifications = sheet.certifications.items
    .map(
      (item) =>
        `<div class="card"><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.body)}</p></div>`
    )
    .join('');

  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>${escapeHtml(sheet.title)}</title>
<style>
  __FONT_FACE__
  @page { size: A4; margin: 13mm 14mm 15mm; }
  * { box-sizing: border-box; }
  /* Lines break between phrases (lang="ja"), not one character away from the end */
  body { margin: 0; font-family: 'Noto Sans JP', sans-serif; color: ${COLORS.ink}; font-size: 9pt; line-height: 1.65; word-break: auto-phrase; }
  header { background: ${COLORS.deep}; color: #fff; border-radius: 3mm; padding: 6mm 8mm 5mm; }
  header .edition { font-size: 8pt; margin: 0 0 1mm; }
  h1 { font-size: 19pt; line-height: 1.4; margin: 0; font-weight: 700; }
  header .subtitle { margin: 2mm 0 0; font-size: 9.5pt; }
  .intro { margin: 4mm 0 0; padding: 3.5mm 5mm; background: ${COLORS.mist}; border-radius: 2mm; }
  .intro .headline { margin: 0; font-weight: 700; font-size: 11pt; color: ${COLORS.deep}; }
  .intro p { margin: 1mm 0 0; }
  .how-to { margin: 3mm 0 0; padding: 3mm 5mm; border: 0.4mm solid ${COLORS.teal}; border-radius: 2mm; }
  .how-to h2 { margin: 0 0 1mm; border: 0; padding: 0; font-size: 10pt; }
  .how-to p { margin: 0; }
  h2 { font-size: 12pt; margin: 5mm 0 1mm; color: ${COLORS.deep}; border-left: 1.2mm solid ${COLORS.teal}; padding-left: 2.5mm; line-height: 1.4; }
  h2 { break-inside: avoid; break-after: avoid; }
  .lead { margin: 0 0 2mm; break-after: avoid; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th, td { border: 0.3mm solid ${COLORS.line}; padding: 2mm 3mm; vertical-align: top; text-align: left; }
  thead th { background: ${COLORS.teal}; color: #fff; font-weight: 700; font-size: 8.5pt; }
  thead th:nth-child(1) { width: 27%; }
  thead th:nth-child(3) { width: 27%; }
  tbody th { background: ${COLORS.mist}; font-weight: 700; }
  tr { break-inside: avoid; }
  ul.checks { list-style: none; margin: 0; padding: 0; }
  ul.checks li { padding-left: 5.5mm; text-indent: -5.5mm; margin: 0 0 1mm; }
  .box { display: inline-block; width: 3.2mm; height: 3.2mm; border: 0.35mm solid ${COLORS.teal}; border-radius: 0.5mm; margin-right: 2.3mm; vertical-align: -0.4mm; text-indent: 0; }
  .note { margin: 1.5mm 0 0; font-size: 8.5pt; color: #4a4a4a; }
  .cards { display: grid; grid-template-columns: 1fr 1fr; gap: 3mm; }
  .card { border: 0.3mm solid ${COLORS.line}; border-radius: 2mm; padding: 3mm 4mm; break-inside: avoid; }
  .card h3 { margin: 0 0 1mm; font-size: 9.5pt; color: ${COLORS.deep}; }
  .card p { margin: 0; font-size: 8.5pt; }
  .closing { margin: 6mm 0 0; break-inside: avoid; }
  .closing p { margin: 0 0 1mm; }
  footer { margin: 6mm 0 0; padding-top: 3mm; border-top: 0.3mm solid ${COLORS.line}; font-size: 8pt; break-inside: avoid; }
  footer p { margin: 0; }
</style>
</head>
<body>
  <header>
    <p class="edition">${escapeHtml(sheet.audience)}　${escapeHtml(sheet.edition)}</p>
    <h1>${escapeHtml(sheet.title)}</h1>
    <p class="subtitle">${escapeHtml(sheet.subtitle)}</p>
  </header>
  <div class="intro">
    <p class="headline">${escapeHtml(sheet.intro.headline)}</p>
    <p>${escapeHtml(sheet.intro.body)}</p>
  </div>
  <section class="how-to">
    <h2>${escapeHtml(sheet.howToUse.heading)}</h2>
    ${sheet.howToUse.lines.map((text) => `<p>${escapeHtml(text)}</p>`).join('')}
  </section>
  ${sections}
  <section>
    <h2>${escapeHtml(sheet.certifications.heading)}</h2>
    <div class="cards">${certifications}</div>
  </section>
  <div class="closing">${sheet.closing.map((text) => `<p>${escapeHtml(text)}</p>`).join('')}</div>
  <footer>
    <p>${escapeHtml(sheet.footer.operator)}</p>
    <p>${escapeHtml(sheet.footer.address)}</p>
    <p>${escapeHtml(sheet.footer.contact)}　${escapeHtml(sheet.footer.hours)}</p>
    <p>${escapeHtml(sheet.footer.companySite)}</p>
  </footer>
</body>
</html>`;
}

async function main() {
  const sheet = webChecklist();
  const output = path.join(process.cwd(), WEB_CHECKLIST_FILE);
  await mkdir(path.dirname(output), { recursive: true });

  const executablePath = process.env.CHROMIUM_EXECUTABLE_PATH;
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  try {
    const page = await browser.newPage();
    const html = sheetHtml(sheet).replace('__FONT_FACE__', await fontFace());
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.pdf({
      path: output,
      format: 'A4',
      preferCSSPageSize: true,
      printBackground: true,
      // Headings and reading order for screen readers, and the outline for the headings
      tagged: true,
      outline: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate:
        '<div style="width:100%;font-size:7pt;color:#666;text-align:center;"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
    });
  } finally {
    await browser.close();
  }
  await writeFile(
    path.join(process.cwd(), WEB_CHECKLIST_DIGEST_FILE),
    `${JSON.stringify({ sha256: webChecklistDigest(sheet) }, null, 2)}\n`
  );
  console.log(`Wrote ${WEB_CHECKLIST_FILE} and ${WEB_CHECKLIST_DIGEST_FILE}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
