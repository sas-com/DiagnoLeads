/**
 * The AX site fonts (app/globals.css).
 * - They must resolve on the element that carries the next/font class (#190). As regular theme
 *   variables they were computed on :root, where --font-noto-sans-jp is undefined, which made the
 *   font-family invalid and the page fell back to the system font.
 * - The Japanese text takes the device's font on phones and touch tablets below 1024px, and Noto
 *   Sans JP from 1024px or with a mouse (#510, decision 2026-10-26-ax-device-font-on-mobile), so
 *   phones load none of its files. test/e2e/ax-landing.spec.ts checks the files a browser loads.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile } from '@tailwindcss/node';
import { beforeAll, describe, expect, it } from 'vitest';

const appDir = join(process.cwd(), 'app');
let source = '';
let output = '';

beforeAll(async () => {
  source = readFileSync(join(appDir, 'globals.css'), 'utf8');
  const compiler = await compile(source, { base: appDir, onDependency: () => {} });
  output = compiler.build(['font-ax', 'font-ax-latin']);
});

/** The families of a font-family value, without quotes */
const families = (value: string) =>
  value
    .split(',')
    .map((family) => family.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);

describe('AX site font utilities', () => {
  it('reference the Japanese font of the width and the next/font Lato directly, with fallbacks', () => {
    expect(output).toMatch(
      /\.font-ax \{\s*font-family: var\(--ax-font-ja, var\(--ax-font-device\)\), sans-serif;/
    );
    expect(output).toMatch(
      /\.font-ax-latin \{\s*font-family: var\(--font-lato, 'Lato'\), 'Lato', var\(--ax-font-ja, var\(--ax-font-device\)\), sans-serif;/
    );
  });

  it('are not theme variables computed on :root', () => {
    expect(output).not.toMatch(/--font-ax(-latin)?:/);
  });
});

describe('the Japanese font of the AX site by device (#510)', () => {
  it('is Noto Sans JP from 1024px or with a mouse, and the device font otherwise, set on the site element', () => {
    const noto = output.match(/@media ([^{]+) \{\s*\.ax-site \{\s*--ax-font-ja: ([^;]+);\s*\}\s*\}/);
    // A desktop keeps Noto Sans JP in a narrow window and in print
    expect(noto?.[1]).toBe('(min-width: 1024px), (hover: hover) and (pointer: fine)');
    // On .ax-site, the element with the next/font class, where --font-noto-sans-jp is defined
    expect(noto?.[2]).toBe("var(--font-noto-sans-jp, 'Noto Sans JP'), 'Noto Sans JP'");
    // The width of lg:, in px like the theme, so a larger default font size does not move it
    expect(source).toMatch(/--breakpoint-lg: 1024px;/);

    const outsideMedia = output.replace(/@media[^{]*\{(?:[^{}]*\{[^}]*\})*[^}]*\}/g, '');
    expect(outsideMedia).toMatch(/\.ax-site \{\s*--ax-font-ja: var\(--ax-font-device\);\s*\}/);
  });

  it('names the Japanese fonts of the devices and none of the families next/font defines', () => {
    const device = families(output.match(/--ax-font-device:\s*([^;]+);/)?.[1] ?? '');
    // iOS and macOS, Android, Windows
    expect(device).toEqual(
      expect.arrayContaining(['Hiragino Kaku Gothic ProN', 'Noto Sans CJK JP', 'Yu Gothic UI'])
    );
    // ProN has W3 and W6 only, so bold is W6 like the Bold of Noto Sans JP
    expect(device.indexOf('Hiragino Kaku Gothic ProN')).toBeLessThan(
      device.indexOf('Hiragino Sans')
    );

    // next/font names its @font-face rules after the Google family ("Noto Sans JP", "Lato" in the
    // production CSS), so a device font of that name would download the web font on phones
    const fontsTs = readFileSync(
      join(process.cwd(), 'components/features/ax-site/fonts.ts'),
      'utf8'
    );
    const imported = fontsTs.match(/import \{([^}]+)\} from 'next\/font\/google'/)?.[1] ?? '';
    const webFamilies = families(imported).map((name) => name.replace(/_/g, ' '));
    expect(webFamilies.sort()).toEqual(['Lato', 'Noto Sans JP']);
    for (const family of webFamilies) {
      expect(device).not.toContain(family);
    }
  });
});
