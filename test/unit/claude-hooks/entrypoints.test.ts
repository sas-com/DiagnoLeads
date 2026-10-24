// @vitest-environment node
/**
 * Hook entry points as Claude Code runs them (#427): JSON on stdin, `bun <script>`, the exit
 * code and the JSON on stdout. The project is a temporary directory holding one decision.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const HOOKS = resolve(__dirname, '../../../.claude/hooks');
let project = '';

function run(script: string, input: Record<string, unknown>) {
  const env: NodeJS.ProcessEnv = { ...process.env, CLAUDE_PROJECT_DIR: project };
  // Never install dependencies from a test, even inside a Claude Code on the web session
  env.CLAUDE_CODE_REMOTE = undefined;
  const result = spawnSync('bun', [join(HOOKS, script)], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env,
  });
  const context = result.stdout.trim()
    ? (JSON.parse(result.stdout) as { hookSpecificOutput: { additionalContext: string } })
        .hookSpecificOutput.additionalContext
    : '';
  return { status: result.status, stderr: result.stderr, context };
}

beforeAll(() => {
  project = mkdtempSync(join(tmpdir(), 'claude-hooks-'));
  mkdirSync(join(project, '.factory/memory/decisions'), { recursive: true });
  writeFileSync(
    join(project, '.factory/memory/decisions/2026-10-22-email-templates.md'),
    [
      '---',
      'id: 2026-10-22-email-templates',
      'date: 2026-10-22',
      'category: Email',
      'title: メールは共通の部品で作り、1つの送信関数で送る（#285）',
      'status: active',
      'superseded_by: []',
      'issues: [285]',
      'paths: [lib/features/email/**]',
      '---',
      '',
    ].join('\n')
  );
});

afterAll(() => {
  rmSync(project, { recursive: true, force: true });
});

describe('pre-tool-guard', () => {
  it('blocks with exit code 2 and tells Claude why', () => {
    const result = run('pre-tool-guard.ts', {
      tool_name: 'Edit',
      tool_input: { file_path: join(project, 'node_modules/x/index.js'), new_string: 'x' },
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('[guard:node_modules]');
    expect(result.stderr).toContain('bun patch');
  });

  it('lets ordinary calls through silently', () => {
    const result = run('pre-tool-guard.ts', {
      tool_name: 'Bash',
      tool_input: { command: 'git status' },
    });
    expect(result).toEqual({ status: 0, stderr: '', context: '' });
  });

  it('never blocks on input it cannot parse', () => {
    const result = spawnSync('bun', [join(HOOKS, 'pre-tool-guard.ts')], {
      input: 'not json',
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toContain('pre-tool-guard:');
  });
});

describe('post-tool-decisions', () => {
  it('names the decisions governing a file once per session', () => {
    const call = {
      session_id: `test-${process.pid}-${Date.now()}`,
      tool_name: 'Read',
      tool_input: { file_path: join(project, 'lib/features/email/email-service.ts') },
    };
    const first = run('post-tool-decisions.ts', call);
    expect(first.status).toBe(0);
    expect(first.context).toContain('lib/features/email/email-service.ts に関係する決定');
    expect(first.context).toContain('2026-10-22-email-templates');

    expect(run('post-tool-decisions.ts', call).context).toBe('');
  });

  it('stays silent for files no decision governs', () => {
    const result = run('post-tool-decisions.ts', {
      session_id: `test-${process.pid}-other`,
      tool_name: 'Edit',
      tool_input: { file_path: join(project, 'components/ui/button.tsx') },
    });
    expect(result).toEqual({ status: 0, stderr: '', context: '' });
  });
});

describe('session-start', () => {
  it('prints the decision index (and installs nothing outside the cloud)', () => {
    const result = run('session-start.ts', { hook_event_name: 'SessionStart', source: 'startup' });
    expect(result.status).toBe(0);
    expect(result.context).toContain('決定の索引（有効 1 件');
    expect(result.context).toContain('- 2026-10-22-email-templates [Email]');
    expect(result.context).not.toContain('依存');
  });

  it('prints nothing on resume or fork, where the conversation already holds the index', () => {
    for (const source of ['resume', 'fork']) {
      expect(run('session-start.ts', { hook_event_name: 'SessionStart', source })).toEqual({
        status: 0,
        stderr: '',
        context: '',
      });
    }
  });
});
