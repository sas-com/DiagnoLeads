// @vitest-environment node
/**
 * Path and temp-file helpers of the hooks (.claude/hooks/lib/io.ts, #461): the checkout a file
 * belongs to (worktrees have a .git file) and the per-user directory for logs and state.
 */
import { chmodSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkoutRoot, privateTmpDir } from '@/.claude/hooks/lib/io';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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
  // A TMPDIR of its own: the real claude-hooks-<uid> holds the state of running sessions, and the
  // second test opens the directory's mode for a moment (#916). os.tmpdir() reads TMPDIR per call.
  const savedTmpdir = process.env.TMPDIR;
  let ownTmpdir = '';

  beforeAll(() => {
    ownTmpdir = mkdtempSync(join(tmpdir(), 'io-test-'));
    process.env.TMPDIR = ownTmpdir;
  });

  afterAll(() => {
    if (savedTmpdir === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = savedTmpdir;
    rmSync(ownTmpdir, { recursive: true, force: true });
  });

  it('lives under the TMPDIR of the process', () => {
    expect(privateTmpDir().startsWith(ownTmpdir)).toBe(true);
  });

  it('is a directory only its owner can open', () => {
    const dir = privateTmpDir();
    const stat = statSync(dir);
    expect(stat.isDirectory()).toBe(true);
    expect(stat.mode & 0o077).toBe(0);
    expect(privateTmpDir()).toBe(dir);
  });

  it('closes an existing directory of ours that others could open', () => {
    const dir = privateTmpDir();
    chmodSync(dir, 0o755);
    privateTmpDir();
    expect(statSync(dir).mode & 0o077).toBe(0);
  });
});
