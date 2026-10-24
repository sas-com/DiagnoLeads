// @vitest-environment node
/**
 * The E2E database helpers (test/e2e/helpers/database.ts) add and delete users, so they must only
 * reach a database on this machine: the check is in connectE2EDatabase itself, so a test that
 * passes DATABASE_URL straight in cannot write to the database .env.local names elsewhere.
 * Nothing here connects: postgres opens a connection only on the first query.
 */
import { describe, expect, it } from 'vitest';
import { connectE2EDatabase, localDatabaseUrl } from '../../e2e/helpers/database';

const REMOTE = 'postgresql://postgres:secret-password@db.example.supabase.co:5432/postgres';

describe('localDatabaseUrl', () => {
  it.each([
    'postgresql://postgres:postgres@localhost:5432/diagnoleads_test',
    'postgres://postgres:postgres@127.0.0.1:55433/dl_test',
    'postgres://postgres:postgres@[::1]:5432/dl_test',
  ])('keeps a database on this machine: %s', (url) => {
    expect(localDatabaseUrl(url)).toBe(url);
  });

  it.each([
    ['another host', REMOTE],
    ['a host that only starts with localhost', 'postgres://u:p@localhost.example.com:5432/db'],
    ['an empty URL', ''],
    ['not a URL', 'localhost:5432'],
  ])('refuses %s', (_name, url) => {
    expect(localDatabaseUrl(url)).toBeUndefined();
  });
});

describe('connectE2EDatabase', () => {
  it('refuses a database elsewhere, without putting the URL in the error', () => {
    let error: unknown;
    try {
      connectE2EDatabase(REMOTE);
    } catch (thrown) {
      error = thrown;
    }

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/only connects to a database on this machine/);
    expect((error as Error).message).not.toContain('secret-password');
    expect((error as Error).message).not.toContain('supabase');
  });

  it('accepts a database on this machine', async () => {
    const database = connectE2EDatabase('postgres://postgres:postgres@127.0.0.1:1/unused');

    await database.close();
  });
});
