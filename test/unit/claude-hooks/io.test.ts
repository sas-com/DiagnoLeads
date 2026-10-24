// @vitest-environment node
/**
 * Path and temp-file helpers of the hooks (.claude/hooks/lib/io.ts, #461): the checkout a file
 * belongs to (worktrees have a .git file) and the per-user directory for logs and state.
 */
import { statSync } from 'node:fs';
import { checkoutRoot, privateTmpDir } from '@/.claude/hooks/lib/io';
import { describe, expect, it } from 'vitest';

describe('checkoutRoot', () => {
  const gitEntries = new Set(['/repo/.git', '/repo/.claude/worktrees/review/.git']);
  const exists = (path: string) => gitEntries.has(path);

  it('finds the nearest directory with a .git entry', () => {
    expect(checkoutRoot('/repo/lib/features/a.ts', '/fallback', exists)).toBe('/repo');
    expect(checkoutRoot('/repo/.claude/worktrees/review/lib/a.ts', '/fallback', exists)).toBe(
      '/repo/.claude/worktrees/review'
    );
  });

  it('falls back outside any checkout', () => {
    expect(checkoutRoot('/elsewhere/a.ts', '/fallback', exists)).toBe('/fallback');
  });
});

describe('privateTmpDir', () => {
  it('is a directory only its owner can open', () => {
    const dir = privateTmpDir();
    const stat = statSync(dir);
    expect(stat.isDirectory()).toBe(true);
    expect(stat.mode & 0o077).toBe(0);
    expect(privateTmpDir()).toBe(dir);
  });
});
