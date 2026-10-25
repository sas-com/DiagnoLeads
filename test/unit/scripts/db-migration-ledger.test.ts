import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  describeSkipped,
  findPending,
  findSkipped,
  findUnknown,
  type JournalMigration,
  readJournal,
  type RecordedMigration,
  WHEN_OUT_OF_ORDER,
} from '@/scripts/db-migration-ledger';

const migration = (tag: string, when: number): JournalMigration => ({ tag, when, hash: `h-${tag}` });
const row = (entry: JournalMigration): RecordedMigration => ({
  hash: entry.hash,
  createdAt: entry.when,
});

describe('findSkipped', () => {
  const base = migration('0000_base', 1000);

  it('passes a database where the migrator has never run', () => {
    expect(findSkipped([base, migration('0001_x', 2000)], [])).toEqual([]);
  });

  it('passes migrations that are newer than the newest recorded one', () => {
    expect(findSkipped([base, migration('0001_x', 2000)], [row(base)])).toEqual([]);
  });

  it('finds a migration older than one another branch applied before merge', () => {
    // 0001_deals (when 3000) is in the database but not in this journal yet
    const applied: RecordedMigration = { hash: 'h-0001_deals', createdAt: 3000 };
    const mine = migration('0001_site_visits', 2000);
    expect(findSkipped([base, mine], [row(base), applied])).toEqual([mine]);
  });

  it('counts a migration as recorded by its when even when its SQL was edited later', () => {
    const edited = migration('0001_x', 2000);
    const later = migration('0002_y', 3000);
    const recorded = [row(base), { hash: 'hash-before-the-edit', createdAt: 2000 }, row(later)];
    expect(findSkipped([base, edited, later], recorded)).toEqual([]);
  });

  it('counts a migration as recorded by its hash', () => {
    const entry = migration('0001_x', 2000);
    const recorded = [row(base), { hash: entry.hash, createdAt: 1999 }, { hash: 'z', createdAt: 3000 }];
    expect(findSkipped([base, entry], recorded)).toEqual([]);
  });

  it('passes the tags in the allowed list', () => {
    const late = migration('0015_agency_links', 2000);
    const recorded = [row(base), { hash: 'h-0014', createdAt: 3000 }];
    expect(findSkipped([base, late], recorded, ['0015_agency_links'])).toEqual([]);
    expect(findSkipped([base, late], recorded, [])).toEqual([late]);
  });

  it('allows 0015_agency_links by default, like the journal test', () => {
    expect(WHEN_OUT_OF_ORDER).toEqual(['0015_agency_links']);
  });
});

describe('findPending', () => {
  const base = migration('0000_base', 1000);
  const next = migration('0001_x', 2000);

  it('runs every migration on a database where the migrator has never run', () => {
    expect(findPending([base, next], [])).toEqual([base, next]);
  });

  it('runs only the migrations newer than the newest recorded one, as drizzle does', () => {
    expect(findPending([base, next], [row(base)])).toEqual([next]);
    expect(findPending([base, next], [row(base), row(next)])).toEqual([]);
  });
});

describe('findUnknown', () => {
  it('lists rows that no journal entry matches by hash or when', () => {
    const base = migration('0000_base', 1000);
    const other: RecordedMigration = { hash: 'h-other', createdAt: 3000 };
    expect(findUnknown([base], [row(base), other])).toEqual([other]);
  });
});

describe('describeSkipped', () => {
  it('names the skipped tag, the newest recorded time and the fix', () => {
    const text = describeSkipped(
      [migration('0001_site_visits', 2000)],
      [{ hash: 'abcdef0123456789', createdAt: 3000 }],
      [{ hash: 'abcdef0123456789', createdAt: 3000 }]
    );
    expect(text).toContain('0001_site_visits  when 2000 (1970-01-01T00:00:02.000Z)');
    expect(text).toContain('3000 (1970-01-01T00:00:03.000Z)');
    expect(text).toContain('created_at 3000 (1970-01-01T00:00:03.000Z)  hash abcdef012345');
    expect(text).toContain('bun run db:generate');
  });
});

describe('readJournal', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-'));
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('pairs each journal entry with the sha256 of its SQL file, as drizzle records it', () => {
    fs.mkdirSync(path.join(dir, 'meta'));
    const entries = [
      { idx: 0, version: '7', when: 1000, tag: '0000_a', breakpoints: true },
      { idx: 1, version: '7', when: 2000, tag: '0001_b', breakpoints: true },
    ];
    fs.writeFileSync(
      path.join(dir, 'meta/_journal.json'),
      JSON.stringify({ version: '7', dialect: 'postgresql', entries })
    );
    fs.writeFileSync(path.join(dir, '0000_a.sql'), 'CREATE TABLE a (id int);');
    fs.writeFileSync(path.join(dir, '0001_b.sql'), 'CREATE TABLE b (id int);');
    const sha = (text: string) => crypto.createHash('sha256').update(text).digest('hex');

    expect(readJournal(dir)).toEqual([
      { tag: '0000_a', when: 1000, hash: sha('CREATE TABLE a (id int);') },
      { tag: '0001_b', when: 2000, hash: sha('CREATE TABLE b (id int);') },
    ]);
  });

  it('reads the repository journal', () => {
    const journal = readJournal(path.join(process.cwd(), 'drizzle'));
    expect(journal.length).toBeGreaterThan(30);
    expect(journal.map((entry) => entry.tag)).toContain('0015_agency_links');
  });
});
