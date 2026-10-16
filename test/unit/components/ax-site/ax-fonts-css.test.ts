/**
 * The AX site fonts must be defined as inline theme variables (#190).
 * next/font defines --font-noto-sans-jp on the site's root element, so a regular theme variable,
 * computed on :root, turned the font-family invalid and the page fell back to the system font.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8');

/** Bodies of the top-level `@theme` blocks, with whether each one is inline */
function themeBlocks(source: string): { inline: boolean; body: string }[] {
  return [...source.matchAll(/^@theme( inline)? \{\n([\s\S]*?)^\}/gm)].map((m) => ({
    inline: m[1] !== undefined,
    body: m[2] ?? '',
  }));
}

describe('AX site font variables', () => {
  it.each(['--font-ax:', '--font-ax-latin:'])('defines %s only in an inline theme', (name) => {
    const blocks = themeBlocks(css).filter((block) => block.body.includes(name));
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.inline).toBe(true);
  });
});
