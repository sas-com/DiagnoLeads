/**
 * Every key handler that acts on Enter or Esc must first ask whether the key belongs to a Japanese
 * conversion (IME): Chrome marks it isComposing, Safari sends it after compositionend with keyCode
 * 229. Without that check the Enter that confirms a conversion sends or saves half-typed text and
 * the Esc that cancels it closes or clears the field. The written learning did not stop it: it came
 * back three times and each was found in review (#969, #1012, #1063), so a check does it (#1129).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const DIRS = ['app', 'components', 'context', 'hooks'];

/** A comparison of the key with Enter or Escape, or a case of a switch on it */
const KEY_CHECK =
  /\bkey\s*[!=]==?\s*['"](Enter|Escape)['"]|['"](Enter|Escape)['"]\s*[!=]==?\s*\w+(\.\w+)*\.key\b|\bcase\s+['"](Enter|Escape)['"]/;

/** The helpers that tell the key of a conversion (components/ui/ime.ts, components/common/form-controls.ts) */
const GUARD = /\b(isImeKey|isComposing|isSendShortcut|isCloseShortcut|ignoreImeEscape)\b/;

/** How many lines above a key check its guard may stand (an early return at the top of the handler) */
const LOOK_BACK = 10;

/**
 * Key checks known to go without the guard, each with its reason. A line is matched by its file and
 * the text it contains, so moving it does not break the entry.
 */
const ALLOWED: { file: string; contains: string; reason: string }[] = [
  {
    file: 'components/features/lead-hearings/hearing-date-inputs.tsx',
    contains: "if (e.key === 'Enter') {",
    reason:
      'The Enter of a conversion still takes the typed date into the box; only onEnter, which moves on, is guarded (reviewed in #853, #1012)',
  },
  {
    file: 'app/[locale]/(dashboard)/settings/embed/page.tsx',
    contains: "e.key === 'Enter' && handleAddOrigin()",
    reason: 'The page goes with #564 (decision 2026-10-24-embed-widget-abolished)',
  },
];

export interface UnguardedKey {
  file: string;
  line: number;
  text: string;
}

/** The key checks of one source file with no guard on the line or the LOOK_BACK lines above it */
export function findUnguardedKeys(file: string, source: string): UnguardedKey[] {
  const lines = source.split('\n');
  const found: UnguardedKey[] = [];
  lines.forEach((text, index) => {
    if (!KEY_CHECK.test(text)) return;
    const window = lines.slice(Math.max(0, index - LOOK_BACK), index + 1).join('\n');
    if (GUARD.test(window)) return;
    found.push({ file, line: index + 1, text: text.trim() });
  });
  return found;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(ts|tsx)$/.test(entry.name))
    .map((entry) => relative(ROOT, join(entry.parentPath, entry.name)));
}

const isAllowed = ({ file, text }: UnguardedKey) =>
  ALLOWED.some((entry) => entry.file === file && text.includes(entry.contains));

describe('findUnguardedKeys', () => {
  it('finds an Enter or Esc handled with no check for a conversion', () => {
    const source = [
      'onKeyDown={(event) => {',
      "  if (event.key === 'Enter') submit();",
      '}}',
      "const onKey = (e) => { if ('Escape' === e.key) close(); };",
      'switch (event.key) {',
      "  case 'Enter':",
      '}',
    ].join('\n');
    expect(findUnguardedKeys('x.tsx', source).map(({ line }) => line)).toEqual([2, 4, 6]);
  });

  it('passes a check guarded on its own line or by an early return above it', () => {
    const source = [
      "if (event.key === 'Enter' && !isComposing(event)) submit();",
      'onKeyDown={(event) => {',
      '  if (isImeKey(event.nativeEvent)) return;',
      "  if (event.key === 'Escape') close();",
      '}}',
      "const close = (event) => isCloseShortcut(event) && event.key === 'Escape';",
    ].join('\n');
    expect(findUnguardedKeys('x.tsx', source)).toEqual([]);
  });

  it('does not count a key that is not Enter or Esc', () => {
    expect(findUnguardedKeys('x.tsx', "if (event.key === 'ArrowDown') next();")).toEqual([]);
  });
});

describe('the Enter and Esc handlers of the app', () => {
  const found = DIRS.flatMap(sourceFiles).flatMap((file) =>
    findUnguardedKeys(file, readFileSync(join(ROOT, file), 'utf8'))
  );

  it('ask whether the key belongs to a conversion first (#1129)', () => {
    // Guard the handler with isComposing (React) or isImeKey (the browser's event), or add it to
    // ALLOWED with the reason it may go without
    expect(found.filter((key) => !isAllowed(key))).toEqual([]);
  });

  it('keep no entry in ALLOWED that no longer matches a line', () => {
    const stale = ALLOWED.filter(
      (entry) => !found.some((key) => key.file === entry.file && key.text.includes(entry.contains))
    );
    expect(stale).toEqual([]);
  });
});
