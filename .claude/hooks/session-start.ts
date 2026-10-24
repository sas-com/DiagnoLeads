/**
 * SessionStart (.claude/settings.json), on every source:
 * - Claude Code on the web starts from a fresh clone without node_modules (also when a session
 *   resumes in a new container), so install the locked dependencies there (about 8 s cold,
 *   well under 1 s when already installed)
 * - print the index of active MemoryBank decisions, so the session starts from the index
 *   instead of reading every decision (bodies are opened when the work needs them). Not on
 *   resume or fork: the conversation brought there already holds it
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DECISIONS_DIR, formatIndex, loadDecisions } from './lib/decisions';
import { addContext, privateTmpDir, projectDir, readHookInput, runHook } from './lib/io';

function installDependencies(root: string): string {
  const started = Date.now();
  const result = spawnSync('bun', ['install', '--frozen-lockfile'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 280_000,
  });
  const log = join(privateTmpDir(), 'session-start-install.log');
  writeFileSync(log, `${result.stdout ?? ''}${result.stderr ?? ''}${result.error ?? ''}`, {
    mode: 0o600,
  });
  const seconds = Math.round((Date.now() - started) / 1000);
  if (result.status === 0) {
    return `依存をインストールした（bun install --frozen-lockfile、${seconds} 秒）。test・typecheck・lint はそのまま動く。`;
  }
  return `依存のインストールに失敗した（終了コード ${result.status ?? 'なし'}、ログ: ${log}）。\`bun install --frozen-lockfile\` を流して原因を確かめてから作業する。`;
}

runHook('session-start', async () => {
  const input = await readHookInput();
  const root = projectDir(input);
  const parts: string[] = [];

  if (process.env.CLAUDE_CODE_REMOTE === 'true') parts.push(installDependencies(root));

  const decisions =
    input.source === 'resume' || input.source === 'fork'
      ? []
      : loadDecisions(join(root, DECISIONS_DIR));
  if (decisions.length > 0) parts.push(formatIndex(decisions));

  if (parts.length > 0) addContext('SessionStart', parts.join('\n\n'));
});
