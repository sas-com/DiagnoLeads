/**
 * Colors of the admin site (#1120, before that DADS: #932): the light theme is the office by
 * day, the dark theme the office by night. The steps keep the roles they had, so the text, the
 * borders and the fills must keep their contrast on the surfaces they are used on.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(process.cwd(), 'app', 'globals.css'), 'utf8');

/** The `--color-…: #rrggbb` declarations of a rule, by name without the `--color-` prefix */
function colorsOf(rule: string): Record<string, string> {
  return Object.fromEntries(
    [...rule.matchAll(/--color-([a-z0-9-]+):\s*(#[0-9a-fA-F]{6});/g)].map(([, name, value]) => [
      name,
      value,
    ])
  );
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

describe('admin site colors', () => {
  const day = colorsOf(css.match(/\nhtml:has\(\.dl-admin\)\s*\{([^}]*)\}/)?.[1] ?? '');
  const night = colorsOf(
    css.match(
      /\nhtml\.dark:has\(\.dl-admin\),\s*html:has\(\.dl-admin\) \.office-night\s*\{([^}]*)\}/
    )?.[1] ?? ''
  );
  const WHITE = '#ffffff';

  it('defines every step of both scales by day and by night', () => {
    const steps = ['25', '50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'];
    for (const theme of [day, night]) {
      for (const step of steps) {
        expect(theme[`brand-${step}`]).toMatch(/^#/);
        expect(theme[`gray-${step}`]).toMatch(/^#/);
      }
    }
  });

  it('keeps the text grays readable by day: 4.5:1 on white, borders and icons 3:1', () => {
    for (const step of ['500', '600', '700', '800', '900']) {
      expect(contrast(day[`gray-${step}`], WHITE)).toBeGreaterThanOrEqual(4.5);
    }
    // The body text also on the marble ground
    for (const step of ['600', '700', '800', '900']) {
      expect(contrast(day[`gray-${step}`], day['gray-50'])).toBeGreaterThanOrEqual(4.5);
    }
    // gray-400 is for borders and icons, never for text
    expect(contrast(day['gray-400'], WHITE)).toBeGreaterThanOrEqual(3);
    expect(contrast(day['gray-400'], WHITE)).toBeLessThan(4.5);
  });

  it('keeps the text grays readable by night on every navy surface', () => {
    // gray-400 is gray-300 by night, as text set in it must keep 4.5:1 on the panels (#932)
    expect(night['gray-400']).toBe(night['gray-300']);
    for (const text of ['50', '100', '200', '300', '400']) {
      for (const surface of ['950', '900', '800', '700']) {
        expect(contrast(night[`gray-${text}`], night[`gray-${surface}`])).toBeGreaterThanOrEqual(
          4.5
        );
      }
    }
    // The borders of controls on the panels
    expect(contrast(night['gray-600'], night['gray-800'])).toBeGreaterThanOrEqual(3);
  });

  it('keeps the night surfaces apart, so that a raised or selected one shows', () => {
    // The panels sit on the ground; inputs, hovered rows and selected tabs sit on the panels
    expect(contrast(night['gray-900'], night['gray-950'])).toBeGreaterThanOrEqual(1.05);
    expect(contrast(night['gray-800'], night['gray-900'])).toBeGreaterThanOrEqual(1.3);
    expect(contrast(night['gray-700'], night['gray-800'])).toBeGreaterThanOrEqual(1.3);
  });

  it('keeps the muted text of the day at 4.5:1 on the marble ground too', () => {
    expect(contrast(day['gray-500'], day['gray-50'])).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps the fills and the brass readable', () => {
    // By day the primary fill is navy under white text, and brass lines reach 3:1 on white
    expect(contrast(WHITE, day['brand-500'])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(WHITE, day['brand-600'])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(day['brand-500'], day['gray-50'])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(day['brand-400'], WHITE)).toBeGreaterThanOrEqual(4.5);
    // The selected item of a list: brand-500 text on the brand-50 tint
    expect(contrast(day['brand-500'], day['brand-50'])).toBeGreaterThanOrEqual(4.5);
    // By night brass is text on the panels, and a fill under the navy text of gray-900
    for (const surface of ['950', '900', '800', '700']) {
      expect(contrast(night['brand-400'], night[`gray-${surface}`])).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(night['gray-900'], night['brand-400'])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(night['gray-900'], night['brand-300'])).toBeGreaterThanOrEqual(4.5);
    // The blue fills that still carry white text by night
    expect(contrast(WHITE, night['brand-500'])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(WHITE, night['brand-600'])).toBeGreaterThanOrEqual(4.5);
  });

  it('still lights the sidebar icons on hover, now that gray-400 and gray-300 match', () => {
    for (const utility of ['menu-item-icon-inactive', 'menu-item-arrow-inactive']) {
      const body = css.match(new RegExp(`@utility ${utility}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
      expect(body).toContain('dark:text-gray-400');
      expect(body).toContain('dark:group-hover:text-gray-100');
    }
  });
});
