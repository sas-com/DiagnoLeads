// @vitest-environment node
/**
 * PreToolUse guard of Claude Code (.claude/hooks/lib/guard.ts, #427): hand edits of
 * node_modules / bun.lock / .env*, secrets in anything written or sent, and commands printing
 * .env* are stopped; documented placeholders, templates and removals are not.
 *
 * Secret-looking values are assembled at run time so this file never holds one itself.
 */
import {
  ALLOW_MARKER,
  checkBashCommand,
  checkEditPath,
  displayPath,
  evaluateToolCall,
  findSecrets,
  isSecretEnvFile,
  newContentOf,
} from '@/.claude/hooks/lib/guard';
import { describe, expect, it } from 'vitest';

const ROOT = '/repo';
const repeat = (char: string, count: number) => char.repeat(count);
const supabaseToken = `sbp_${repeat('a', 40)}`;
const anthropicKey = `sk-ant-api03-${repeat('A', 30)}`;
const productionUrl = [
  'postgresql://postgres.abcdefgh',
  'S3cretPassw0rd@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres',
].join(':');

describe('checkEditPath', () => {
  it('stops node_modules anywhere, and the shared Bun cache outside the project', () => {
    expect(checkEditPath('node_modules/sonner/dist/index.js')?.rule).toBe('node_modules');
    expect(checkEditPath('packages/x/node_modules/a.js')?.rule).toBe('node_modules');
    expect(checkEditPath('/root/.bun/install/cache/sonner@1.7.0/dist/index.js')?.rule).toBe(
      'node_modules'
    );
  });

  it('stops the lockfile and secret env files', () => {
    expect(checkEditPath('bun.lock')?.rule).toBe('lockfile');
    expect(checkEditPath('.env')?.rule).toBe('env-file');
    expect(checkEditPath('.env.local')?.rule).toBe('env-file');
    expect(checkEditPath('.env.production.local')?.rule).toBe('env-file');
  });

  it('lets templates and ordinary files through', () => {
    expect(checkEditPath('.env.example')).toBeNull();
    expect(checkEditPath('.env.production.example')).toBeNull();
    expect(checkEditPath('lib/features/leads/service.ts')).toBeNull();
    expect(checkEditPath('docs/environment.md')).toBeNull();
    expect(checkEditPath('patches/sonner@1.7.0.patch')).toBeNull();
  });
});

describe('isSecretEnvFile', () => {
  it.each([
    ['.env', true],
    ['.env.local', true],
    ['.env.test', true],
    ['.env.example', false],
    ['.env.production.example', false],
    ['env.ts', false],
    ['.envrc', false],
  ])('%s → %s', (name, expected) => {
    expect(isSecretEnvFile(name)).toBe(expected);
  });
});

describe('findSecrets', () => {
  it('finds a production connection string and tokens', () => {
    expect(findSecrets(`DATABASE_URL="${productionUrl}"`)).toEqual([
      'パスワード付きの DB 接続文字列',
    ]);
    expect(findSecrets(`token: ${supabaseToken}`)).toEqual(['Supabase のアクセストークン']);
    expect(findSecrets(`ANTHROPIC_API_KEY=${anthropicKey}`)).toContain('Anthropic の API キー');
    expect(findSecrets(`-----BEGIN ${'RSA PRIVATE'} KEY-----`)).toEqual(['秘密鍵']);
    expect(findSecrets(`key AKIA${repeat('B', 16)} here`)).toEqual(['AWS のアクセスキー']);
    expect(findSecrets(`re_${repeat('c', 8)}_${repeat('D', 24)}`)).toEqual(['Resend の API キー']);
  });

  it('leaves the local, CI and documented example connection strings alone', () => {
    const examples = [
      'postgresql://postgres:postgres@localhost:5432/diagnoleads_dev',
      'postgres://postgres:postgres@127.0.0.1:55432/dl_test',
      'postgresql://user:password@host:5432/diagnoleads_prod?sslmode=require',
      'postgresql://user:password@ep-xxx.us-east-2.aws.neon.tech/diagnoleads?sslmode=require',
      'postgresql://test:test@localhost:5432/test',
      'postgresql://postgres:[YOUR-PASSWORD]@db.abcdefgh.supabase.co:5432/postgres',
      'DATABASE_URL=postgresql://user:${DB_PASSWORD}@db.internal.example.com/app',
    ];
    for (const example of examples) expect(findSecrets(example), example).toEqual([]);
  });

  it('skips a line marked as allowed, but only that line', () => {
    expect(findSecrets(`const fake = '${supabaseToken}'; // ${ALLOW_MARKER}`)).toEqual([]);
    expect(findSecrets(`// ${ALLOW_MARKER}\nconst real = '${supabaseToken}';`)).toEqual([
      'Supabase のアクセストークン',
    ]);
  });

  it('does not mistake regular code, regexes or test keys for secrets', () => {
    const code = [
      "process.env.ANTHROPIC_API_KEY = 'test-api-key';",
      "const pattern = /sbp_[a-f0-9]{40}/;",
      'const taskId = "task-0123456789abcdef0123456789abcdef";',
      "turnstile.secret = '1x0000000000000000000000000000000AA';",
    ].join('\n');
    expect(findSecrets(code)).toEqual([]);
  });
});

describe('newContentOf', () => {
  it('takes only the text a tool would add, so removing a secret is allowed', () => {
    expect(newContentOf('Edit', { old_string: supabaseToken, new_string: 'x' })).toEqual(['x']);
    expect(
      newContentOf('MultiEdit', {
        edits: [
          { old_string: 'a', new_string: 'b' },
          { old_string: 'c', new_string: 'd' },
        ],
      })
    ).toEqual(['b', 'd']);
    expect(newContentOf('Write', { file_path: 'a.ts', content: 'body' })).toEqual(['body']);
    expect(newContentOf('Bash', { command: 'ls', description: 'list' })).toEqual(['ls']);
  });

  it('takes every string an MCP tool would send', () => {
    expect(
      newContentOf('mcp__github__issue_write', {
        owner: 'o',
        body: 'b',
        labels: ['l1'],
        nested: { text: 't' },
      })
    ).toEqual(['o', 'b', 'l1', 't']);
  });
});

describe('checkBashCommand', () => {
  it('stops printing a secret env file', () => {
    expect(checkBashCommand('cat .env.local')?.rule).toBe('env-read');
    expect(checkBashCommand('grep DATABASE_URL .env.local')?.rule).toBe('env-read');
    expect(checkBashCommand('cd /repo && tail -n 5 ./.env')?.rule).toBe('env-read');
    expect(checkBashCommand('FOO=1 cat "/repo/.env.production"')?.rule).toBe('env-read');
  });

  it('allows templates, presence checks and commands that only load the file', () => {
    expect(checkBashCommand('cat .env.example')).toBeNull();
    expect(checkBashCommand("grep -q '^RESEND_API_KEY=' .env.local && echo set")).toBeNull();
    expect(checkBashCommand('grep -c DATABASE_URL .env.local')).toBeNull();
    expect(checkBashCommand('set -a && source .env.local && bun run db:migrate')).toBeNull();
    expect(checkBashCommand('bun run test:run')).toBeNull();
    expect(checkBashCommand('ls -la .env*')).toBeNull();
  });
});

describe('evaluateToolCall', () => {
  it('applies the path rules to edits, inside the project and outside it', () => {
    expect(evaluateToolCall('Edit', { file_path: `${ROOT}/node_modules/a.js` }, ROOT)?.rule).toBe(
      'node_modules'
    );
    expect(evaluateToolCall('Write', { file_path: '.env.local', content: 'A=1' }, ROOT)?.rule).toBe(
      'env-file'
    );
    expect(
      evaluateToolCall('NotebookEdit', { notebook_path: `${ROOT}/bun.lock`, new_source: '' }, ROOT)
        ?.rule
    ).toBe('lockfile');
  });

  it('stops secrets in edits, commands and MCP calls', () => {
    expect(
      evaluateToolCall('Write', { file_path: `${ROOT}/docs/a.md`, content: productionUrl }, ROOT)
        ?.rule
    ).toBe('secret');
    expect(evaluateToolCall('Bash', { command: `echo ${supabaseToken}` }, ROOT)?.rule).toBe(
      'secret'
    );
    expect(
      evaluateToolCall('mcp__github__add_issue_comment', { body: `接続先 ${productionUrl}` }, ROOT)
        ?.rule
    ).toBe('secret');
  });

  it('lets ordinary work through', () => {
    expect(
      evaluateToolCall(
        'Edit',
        { file_path: `${ROOT}/lib/a.ts`, old_string: 'a', new_string: 'b' },
        ROOT
      )
    ).toBeNull();
    expect(evaluateToolCall('Bash', { command: 'git status' }, ROOT)).toBeNull();
    expect(evaluateToolCall('Read', { file_path: `${ROOT}/.env.example` }, ROOT)).toBeNull();
  });
});

describe('displayPath', () => {
  it('is relative inside the project and absolute outside it', () => {
    expect(displayPath(ROOT, `${ROOT}/lib/a.ts`)).toBe('lib/a.ts');
    expect(displayPath(ROOT, 'lib/a.ts')).toBe('lib/a.ts');
    expect(displayPath(ROOT, '/tmp/a.ts')).toBe('/tmp/a.ts');
  });
});
