/**
 * PostToolUse (.claude/settings.json): when Claude reads or edits a file that active MemoryBank
 * decisions govern (their `paths`), name those decisions once per session. Format and
 * matching: ./lib/decisions.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DECISIONS_DIR, decisionsForPath, formatPathNotice, loadDecisions } from './lib/decisions';
import { displayPath } from './lib/guard';
import { addContext, projectDir, readHookInput, runHook } from './lib/io';

function seenFile(sessionId: string): string {
  return join(tmpdir(), `claude-decisions-${sessionId.replace(/[^A-Za-z0-9_-]/g, '')}.json`);
}

function readSeen(file: string): Set<string> {
  try {
    return new Set(JSON.parse(readFileSync(file, 'utf8')) as string[]);
  } catch {
    return new Set();
  }
}

runHook('post-tool-decisions', async () => {
  const input = await readHookInput();
  const target = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
  if (typeof target !== 'string' || !target) return;

  const root = projectDir(input);
  const path = displayPath(root, target);
  // Outside the project, the memory itself, and dependencies are never governed by a decision
  if (path.startsWith('/') || path.startsWith('.factory/memory/')) return;
  if (path.split('/').includes('node_modules')) return;

  const matched = decisionsForPath(loadDecisions(join(root, DECISIONS_DIR)), path);
  if (matched.length === 0) return;

  const file = input.session_id ? seenFile(input.session_id) : null;
  const seen = file ? readSeen(file) : new Set<string>();
  const fresh = matched.filter((decision) => !seen.has(decision.id));
  if (fresh.length === 0) return;

  if (file) {
    for (const decision of fresh) seen.add(decision.id);
    writeFileSync(file, JSON.stringify([...seen]));
  }
  addContext('PostToolUse', formatPathNotice(path, fresh));
});
