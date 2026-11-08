/**
 * Admin site in dark mode (#932): text set in gray-400 must reach DADS's 4.5:1 on the dark
 * surfaces. gray-400 becomes Solid Gray 300 there, in the same rule as the dark text colors.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(process.cwd(), 'app', 'globals.css'), 'utf8');
const tokens = readFileSync(
  join(process.cwd(), 'node_modules', '@digital-go-jp', 'design-tokens', 'dist', 'tokens.css'),
  'utf8'
);

function solidGray(step: string): string {
  const match = tokens.match(new RegExp(`--color-neutral-solid-gray-${step}:\\s*(#[0-9a-fA-F]{6})`));
  if (!match) throw new Error(`Solid Gray ${step} not found`);
  return match[1];
}

// WCAG 2 contrast ratio of two #rrggbb colors
function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('admin site dark text', () => {
  const rule = css.match(/\nhtml\.dark:has\(\.dl-admin\)\s*\{([^}]*)\}/)?.[1] ?? '';

  it('turns gray-400 into Solid Gray 300 in dark mode only', () => {
    expect(rule).toContain('--color-gray-400: var(--color-neutral-solid-gray-300);');
    // Light mode keeps Solid Gray 420 for borders and icons
    const light = css.match(/\nhtml:has\(\.dl-admin\)\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(light).toContain('--color-gray-400: var(--color-neutral-solid-gray-420);');
  });

  it('gives that gray 4.5:1 on the dark cards and page', () => {
    const text = solidGray('300');
    // gray-800 and gray-900 of the admin site are Solid Gray 800 and 900
    expect(contrast(text, solidGray('800'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(text, solidGray('900'))).toBeGreaterThanOrEqual(4.5);
    // Solid Gray 420 did not reach it on gray-800
    expect(contrast(solidGray('420'), solidGray('800'))).toBeLessThan(4.5);
  });
});
