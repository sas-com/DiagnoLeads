// @vitest-environment node
/**
 * The production backup leaves out public.site_visit_salts, which the read-only role cannot read
 * (#412, #1126), and the restore recreates it empty with the definition of the migration that made
 * it. If either side drifts, the daily dump stops again or a restored database lacks the table.
 */
import { readFileSync } from 'node:fs';
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

  it('recreate the table only after the dump is restored', () => {
    const restore = read('scripts/prod-restore-to.sh');
    expect(restore.indexOf('CREATE TABLE "site_visit_salts"')).toBeGreaterThan(
      restore.indexOf('pg_restore -d "$TARGET_URL"')
    );
  });
});
