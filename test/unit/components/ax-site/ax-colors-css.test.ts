/**
 * The greens of the AX site (#420) also reach the parts drawn outside `.ax-site` in a portal,
 * such as the calendar of the meeting form, and the favicons of its pages (#537). The builder's
 * diagnoses, outside the site, keep the teal.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(process.cwd(), 'app', 'globals.css'), 'utf8');

describe('AX site colours', () => {
  it('turn the teal names green inside the site and on the html element of its pages', () => {
    // Two rules: a browser without :has() drops a whole selector list that has it
    for (const selector of [/\n\.ax-site\s*\{([^}]*)\}/, /\nhtml:has\(\.ax-site\)\s*\{([^}]*)\}/]) {
      const rules = [...css.matchAll(new RegExp(selector, 'g'))].map((match) => match[1]);
      const rule = rules.find((body) => body.includes('--color-ax-teal')) ?? '';
      expect(rule).toContain('--color-ax-teal: #258a2f');
      expect(rule).toContain('--color-ax-teal-dark: var(--color-ax-leaf)');
      expect(rule).toContain('--color-ax-deep: var(--color-ax-forest)');
    }
    expect(css).not.toMatch(/\.ax-site,\s*html:has/);
    // The theme keeps the teal for the rest of the app
    expect(css).toMatch(/--color-ax-teal: #06908f;/);
  });

  it('give the favicons of the site the same green', () => {
    // The unsubscribe page of the site's emails is a page of the site too
    for (const page of ['ax-migration', 'ax-diagnosis', 'email']) {
      const svg = readFileSync(join(process.cwd(), 'app', '[locale]', '(ax)', page, 'icon.svg'), 'utf8');
      expect(svg).toContain('fill="#18730e"');
      expect(svg).not.toContain('#087270');
    }
  });
});
