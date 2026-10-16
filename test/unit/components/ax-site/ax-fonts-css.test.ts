/**
 * The AX site fonts must resolve on the element that carries the next/font class (#190).
 * As regular theme variables they were computed on :root, where --font-noto-sans-jp is undefined,
 * which made the font-family invalid and the page fell back to the system font.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile } from '@tailwindcss/node';
import { beforeAll, describe, expect, it } from 'vitest';

const appDir = join(process.cwd(), 'app');
let output = '';

beforeAll(async () => {
  const css = readFileSync(join(appDir, 'globals.css'), 'utf8');
  const compiler = await compile(css, { base: appDir, onDependency: () => {} });
  output = compiler.build(['font-ax', 'font-ax-latin']);
});

describe('AX site font utilities', () => {
  it('reference the next/font variables directly, with fallbacks', () => {
    expect(output).toMatch(/\.font-ax \{\s*font-family: var\(--font-noto-sans-jp, 'Noto Sans JP'\)/);
    expect(output).toMatch(/\.font-ax-latin \{\s*font-family: var\(--font-lato, 'Lato'\)/);
  });

  it('are not theme variables computed on :root', () => {
    expect(output).not.toMatch(/--font-ax(-latin)?:/);
  });
});
