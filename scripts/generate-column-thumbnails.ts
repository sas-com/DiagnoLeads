/**
 * Thumbnails of the AX column articles (#335): one 1200x630 PNG per article in
 * public/images/columns/<slug>.png, used at the top of the article, on the list and for sharing.
 *
 * Usage: bun run columns:thumbnails
 *
 * Each card is an HTML page rendered by headless Chromium (Playwright). The fonts of the site
 * (Noto Sans JP, Lato) are loaded from Google Fonts while generating, so this needs the network;
 * only the PNGs are committed. Run it again after adding or retitling an article: the column test
 * fails while an article has no thumbnail.
 */

import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  COLUMNS,
  COLUMN_THUMBNAIL_MAX_LINES,
  COLUMN_THUMBNAIL_SIZE,
  type Column,
  type ColumnLocale,
  type ColumnThumbnailAccent,
  type ColumnThumbnailIcon,
  columnThumbnailPath,
  validateColumn,
} from '@/lib/features/ax-site/columns';
import ja from '@/locales/ja/common.json';
import { chromium } from '@playwright/test';
import {
  CalendarX,
  Database,
  FileLock,
  FolderOpen,
  GitFork,
  HardDrive,
  type LucideIcon,
  Scale,
  ShieldAlert,
  Users,
} from 'lucide-react';
import { createTranslator } from 'next-intl';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/** Colours of the AX site (app/globals.css) */
const AX = {
  deep: '#033b3a',
  tealDark: '#087270',
  teal: '#06908f',
  yellow: '#ecda5a',
  mist: '#f3f3f3',
} as const;

const ACCENTS: Record<ColumnThumbnailAccent, string> = { yellow: AX.yellow, mist: AX.mist };

const ICONS: Record<ColumnThumbnailIcon, LucideIcon> = {
  'calendar-x': CalendarX,
  'shield-alert': ShieldAlert,
  'git-fork': GitFork,
  scale: Scale,
  'folder-open': FolderOpen,
  users: Users,
  'file-lock': FileLock,
  database: Database,
  'hard-drive': HardDrive,
};

const MESSAGES: Record<ColumnLocale, typeof ja> = { ja };

/** Largest and smallest title size in px: the largest one whose lines fit is used */
const TITLE_MAX_SIZE = 68;
const TITLE_MIN_SIZE = 44;
/** Width of the title column in px (the icon takes the right side) */
const TITLE_WIDTH = 720;
/** Files above this size are refused (OG crawlers and the list page load them) */
const MAX_BYTES = 200 * 1024;

const FONTS_CSS =
  'https://fonts.googleapis.com/css2?family=Lato:wght@900&family=Noto+Sans+JP:wght@500;700;900&display=block';

const OUT_DIR = path.join(process.cwd(), 'public');

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function iconSvg(icon: ColumnThumbnailIcon, color: string): string {
  return renderToStaticMarkup(
    createElement(ICONS[icon], { size: 132, color, strokeWidth: 1.5, 'aria-hidden': true })
  );
}

/**
 * Geometric background in flat colours: stepped discs behind the icon, a dot grid on the right
 * and a corner mark in the accent colour
 */
function patternSvg(accent: string): string {
  const discs = [
    { r: 372, fill: '#04403f' },
    { r: 300, fill: '#054746' },
    { r: 228, fill: '#064f4e' },
  ]
    .map(({ r, fill }) => `<circle cx="960" cy="300" r="${r}" fill="${fill}"/>`)
    .join('');
  return `
<svg class="pattern" width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <pattern id="dots" x="0" y="0" width="24" height="24" patternUnits="userSpaceOnUse">
      <rect x="0" y="0" width="3" height="3" fill="#ffffff" fill-opacity="0.12"/>
    </pattern>
  </defs>
  ${discs}
  <rect x="${600}" y="0" width="600" height="630" fill="url(#dots)"/>
  <path d="M1200 0 L1200 132 L1068 0 Z" fill="${accent}"/>
</svg>`;
}

function cardHtml(column: Column): string {
  const t = createTranslator({ locale: column.locale, messages: MESSAGES[column.locale] });
  const label = t('axColumn.thumbnailLabel', { topic: t(`axColumn.topics.${column.related}`) });
  const accent = ACCENTS[column.thumbnail.accent ?? 'yellow'];
  const lines = column.thumbnail.lines;
  const title = lines
    ? lines.map((line) => `<span class="line">${escapeHtml(line)}</span>`).join('')
    : escapeHtml(column.title);

  return `<!doctype html>
<html lang="${column.locale}">
<head>
<meta charset="utf-8">
<link rel="stylesheet" href="${FONTS_CSS}">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: 1200px; height: 630px; overflow: hidden; }
  body {
    font-family: 'Noto Sans JP', sans-serif;
    color: #ffffff;
    -webkit-font-smoothing: antialiased;
  }
  .card {
    position: relative;
    width: 1200px;
    height: 630px;
    overflow: hidden;
    /* Flat colours only: smooth gradients make the PNG several times larger */
    background: ${AX.deep};
  }
  .pattern { position: absolute; inset: 0; }
  .label {
    position: absolute;
    top: 64px;
    left: 80px;
    display: flex;
    align-items: center;
    gap: 14px;
    font-size: 26px;
    font-weight: 700;
    letter-spacing: 0.06em;
    color: ${AX.mist};
  }
  .label::before {
    content: '';
    width: 10px;
    height: 30px;
    border-radius: 2px;
    background: ${accent};
  }
  .title-area {
    position: absolute;
    top: 130px;
    bottom: 132px;
    left: 80px;
    width: ${TITLE_WIDTH}px;
    display: flex;
    align-items: center;
  }
  .title {
    width: 100%;
    font-weight: 700;
    line-height: 1.42;
    letter-spacing: 0.02em;
    font-feature-settings: 'palt';
    line-break: strict;
    text-wrap: pretty;
      }
  .title .line { display: block; white-space: nowrap; }
  .icon {
    position: absolute;
    left: 840px;
    top: 180px;
    width: 240px;
    height: 240px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: ${AX.tealDark};
    border: 3px solid ${accent};
  }
  .footer {
    position: absolute;
    left: 80px;
    right: 80px;
    bottom: 56px;
    padding-top: 26px;
    border-top: 1px solid rgba(255, 255, 255, 0.22);
    display: flex;
    align-items: baseline;
    justify-content: space-between;
  }
  .brand { display: flex; align-items: baseline; gap: 6px; }
  .brand .ax {
    font-family: 'Lato', 'Noto Sans JP', sans-serif;
    font-weight: 900;
    font-size: 40px;
    letter-spacing: -0.01em;
  }
  .brand .name { font-size: 28px; font-weight: 700; }
  .operator { font-size: 24px; font-weight: 500; color: rgba(255, 255, 255, 0.9); }
</style>
</head>
<body>
<div class="card">
  ${patternSvg(accent)}
  <p class="label">${escapeHtml(label)}</p>
  <div class="title-area"><h1 class="title" id="title">${title}</h1></div>
  <div class="icon">${iconSvg(column.thumbnail.icon, accent)}</div>
  <div class="footer">
    <p class="brand"><span class="ax">AX</span><span class="name">${escapeHtml(ja.axSite.brand.name)}</span></p>
    <p class="operator">${escapeHtml(ja.axSite.brand.operator)}</p>
  </div>
</div>
</body>
</html>`;
}

interface Fit {
  size: number;
  lines: number;
  fonts: boolean;
}

/** In the page: the largest title size whose lines fit, and whether the web fonts are in use */
function fitTitle({
  maxSize,
  minSize,
  maxLines,
  text,
}: { maxSize: number; minSize: number; maxLines: number; text: string }): Promise<Fit> {
  return (async () => {
    const families = ['700 64px "Noto Sans JP"', '500 24px "Noto Sans JP"', '900 40px "Lato"'];
    await Promise.all(families.map((font) => document.fonts.load(font, text)));
    await document.fonts.ready;
    // check() alone is true when no face of the family exists at all: require loaded web faces
    const loaded = [...document.fonts].filter((face) => face.status === 'loaded');
    const fonts =
      ['Noto Sans JP', 'Lato'].every((family) =>
        loaded.some((face) => face.family.replace(/["']/g, '') === family)
      ) && families.every((font) => document.fonts.check(font, text));

    const title = document.getElementById('title') as HTMLElement;
    const area = title.parentElement as HTMLElement;
    const explicit = [...title.querySelectorAll<HTMLElement>('.line')];
    for (let size = maxSize; size >= minSize; size -= 2) {
      title.style.fontSize = `${size}px`;
      const lineHeight = Number.parseFloat(getComputedStyle(title).lineHeight);
      const lines = Math.round(title.offsetHeight / lineHeight);
      const wide = explicit.some((line) => line.scrollWidth > title.clientWidth);
      if (!wide && lines <= maxLines && title.offsetHeight <= area.clientHeight) {
        return { size, lines, fonts };
      }
    }
    return { size: 0, lines: 0, fonts };
  })();
}

async function main() {
  const problems = COLUMNS.flatMap((column) =>
    validateColumn(column).map((problem) => `${column.slug}: ${problem}`)
  );
  if (problems.length > 0) throw new Error(`Fix the articles first:\n${problems.join('\n')}`);

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: COLUMN_THUMBNAIL_SIZE.width, height: COLUMN_THUMBNAIL_SIZE.height },
      deviceScaleFactor: 1,
    });
    for (const column of COLUMNS) {
      await page.setContent(cardHtml(column), { waitUntil: 'networkidle' });
      const text = `${column.title}${ja.axSite.brand.name}${ja.axSite.brand.operator}AX`;
      const fit = await page.evaluate(fitTitle, {
        maxSize: TITLE_MAX_SIZE,
        minSize: TITLE_MIN_SIZE,
        maxLines: COLUMN_THUMBNAIL_MAX_LINES,
        text: `${text}${await page.locator('.label').innerText()}`,
      });
      if (!fit.fonts) throw new Error(`${column.slug}: the web fonts did not load`);
      if (fit.size === 0) {
        throw new Error(
          `${column.slug}: the title does not fit in ${COLUMN_THUMBNAIL_MAX_LINES} lines; set thumbnail.lines`
        );
      }

      const file = path.join(OUT_DIR, columnThumbnailPath(column.slug));
      await mkdir(path.dirname(file), { recursive: true });
      const png = await page.screenshot({ type: 'png', animations: 'disabled', caret: 'hide' });
      if (png.byteLength > MAX_BYTES) {
        throw new Error(`${column.slug}: ${png.byteLength} bytes, above ${MAX_BYTES}`);
      }
      await writeFile(file, png);
      const { size } = await stat(file);
      console.log(
        `${path.relative(process.cwd(), file)}  ${(size / 1024).toFixed(1)} KB  title ${fit.size}px, ${fit.lines} lines`
      );
    }
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
