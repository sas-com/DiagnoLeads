// @vitest-environment node
/**
 * The production backup leaves out public.site_visit_salts, which the read-only role cannot read
 * (#412, #1126), and the restore recreates it empty with the definition of the migration that made
 * it. If either side drifts, the daily dump stops again or a restored database lacks the table.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');
const squash = (sql: string) => sql.replace(/\s+/g, ' ').trim();

const createSaltsTable = (sql: string) => {
  const match = sql.match(/CREATE TABLE "site_visit_salts" \([\s\S]*?\n\);/);
  return match ? squash(match[0]) : null;
};

describe('production backup scripts', () => {
  it('leave the whole site_visit_salts table out of the dump, not only its data', () => {
    const dump = read('scripts/prod-dump.sh');
    expect(dump).toContain('--exclude-table=public.site_visit_salts');
    // pg_dump still locks a table whose data alone is left out, which needs SELECT
    expect(dump).not.toContain('--exclude-table-data');
  });

  it('recreate site_visit_salts on restore with the definition from its migration', () => {
    const migration = createSaltsTable(read('drizzle/0031_site_visits.sql'));
    const restore = read('scripts/prod-restore-to.sh');
    expect(migration).not.toBeNull();
    expect(createSaltsTable(restore)).toBe(migration);
    expect(restore).toContain('ALTER TABLE "site_visit_salts" ENABLE ROW LEVEL SECURITY;');
  });

  it('compare with the only migration that defines the table', () => {
    // A later migration that changes site_visit_salts must also change the restore
    const touching = readdirSync('drizzle')
      .filter((name) => name.endsWith('.sql'))
      .filter((name) => read(`drizzle/${name}`).includes('site_visit_salts'));
    expect(touching).toEqual(['0031_site_visits.sql']);
  });

  it('create the table and turn on row level security in one transaction', () => {
    const restore = read('scripts/prod-restore-to.sh');
    const begin = restore.indexOf('BEGIN;');
    expect(begin).toBeGreaterThan(-1);
    expect(begin).toBeLessThan(restore.indexOf('CREATE TABLE "site_visit_salts"'));
    expect(restore.indexOf('COMMIT;')).toBeGreaterThan(
      restore.indexOf('ALTER TABLE "site_visit_salts" ENABLE ROW LEVEL SECURITY;')
    );
  });

  it('withdraw the anon and authenticated grants before and after the restore (#1184)', () => {
    const restore = read('scripts/prod-restore-to.sh');
    expect(read('scripts/supabase/prepare.sql')).toContain(
      'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;'
    );
    // Found before the URL is asked for, so a copied script stops before writing anything
    expect(restore.indexOf('[ -r "$PREPARE" ]')).toBeGreaterThan(-1);
    expect(restore.indexOf('[ -r "$PREPARE" ]')).toBeLessThan(restore.indexOf('read -rsp'));

    const run = 'psql_ < "$PREPARE"';
    const first = restore.indexOf(run);
    const last = restore.lastIndexOf(run);
    // Before the restore, so a restore that stops halfway leaves no table open to the Data API
    expect(first).toBeGreaterThan(-1);
    expect(first).toBeLessThan(restore.indexOf('pg_restore -d "$TARGET_URL"'));
    // and again after the salt table, for whatever is left
    expect(last).toBeGreaterThan(restore.indexOf('CREATE TABLE "site_visit_salts"'));
  });

  it('stop when anon or authenticated can still use something in public (#1184)', () => {
    const restore = read('scripts/prod-restore-to.sh');
    const check = restore.indexOf("has_table_privilege('anon'");
    // Effective privileges (through PUBLIC too), tables and sequences, after the last withdrawal
    expect(check).toBeGreaterThan(restore.lastIndexOf('psql_ < "$PREPARE"'));
    expect(restore).toContain("has_sequence_privilege('anon'");
    const stop = restore.indexOf('exit 1', check);
    expect(stop).toBeGreaterThan(check);
    expect(stop).toBeLessThan(restore.indexOf('echo "Restored'));
  });

  it('recreate the table only after the dump is restored', () => {
    const restore = read('scripts/prod-restore-to.sh');
    expect(restore.indexOf('CREATE TABLE "site_visit_salts"')).toBeGreaterThan(
      restore.indexOf('pg_restore -d "$TARGET_URL"')
    );
  });
});
