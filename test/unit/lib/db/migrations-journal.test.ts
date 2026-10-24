import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * drizzle's migrator skips, without an error, every migration whose `when` is not newer than the
 * last one recorded in the database (node_modules/drizzle-orm/pg-core/dialect.js). Two branches
 * that both generate the next number, or a rebase that keeps an old `when`, therefore lose a
 * migration in production while `db:migrate` reports success (#452).
 */

interface JournalEntry {
  idx: number;
  tag: string;
  when: number;
}

interface Snapshot {
  id: string;
  prevId: string;
}

interface Exceptions {
  /** Tags whose `when` is older than an earlier entry and that are already in production. */
  whenOutOfOrder: string[];
  /** SQL files in drizzle/ that the journal does not list. */
  sqlOutsideJournal: string[];
}

const EXCEPTIONS: Exceptions = {
  // Generated before 0013/0014 were merged. Kept so the hashes in production stay the same
  whenOutOfOrder: ['0015_agency_links'],
  // Never journaled. #433 decides whether its indexes become a real migration
  sqlOutsideJournal: ['0001_performance_optimization'],
};

const FIX =
  'Merge main, delete your own drizzle/<n>_*.sql and drizzle/meta/<n>_snapshot.json and the ' +
  'journal entry, then run `bun run db:generate` again so the number and `when` come after main.';

function journalProblems(
  entries: JournalEntry[],
  sqlTags: string[],
  snapshots: Map<number, Snapshot>,
  exceptions: Exceptions
): string[] {
  const problems: string[] = [];
  let newest = Number.NEGATIVE_INFINITY;

  entries.forEach((entry, position) => {
    if (entry.idx !== position) {
      problems.push(`entry ${position} has idx ${entry.idx} (numbers must be 0, 1, 2, ...)`);
    }
    const prefix = String(entry.idx).padStart(4, '0');
    if (!entry.tag.startsWith(`${prefix}_`)) {
      problems.push(`${entry.tag} does not start with its idx ${prefix}`);
    }
    if (entry.when <= newest && !exceptions.whenOutOfOrder.includes(entry.tag)) {
      problems.push(`${entry.tag} has a when that is not newer than an earlier migration`);
    }
    newest = Math.max(newest, entry.when);

    const snapshot = snapshots.get(entry.idx);
    if (!snapshot) {
      problems.push(`${entry.tag} has no drizzle/meta/${prefix}_snapshot.json`);
    } else if (position > 0) {
      const previous = snapshots.get(entries[position - 1].idx);
      if (previous && snapshot.prevId !== previous.id) {
        problems.push(`${prefix}_snapshot.json does not follow the previous snapshot (prevId)`);
      }
    }
  });

  const tags = new Set(entries.map((entry) => entry.tag));
  for (const tag of sqlTags) {
    if (!tags.has(tag) && !exceptions.sqlOutsideJournal.includes(tag)) {
      problems.push(`drizzle/${tag}.sql is not in the journal`);
    }
  }
  for (const tag of tags) {
    if (!sqlTags.includes(tag)) problems.push(`the journal lists ${tag} but drizzle/${tag}.sql is missing`);
  }
  for (const tag of exceptions.sqlOutsideJournal) {
    if (tags.has(tag) || !sqlTags.includes(tag)) problems.push(`remove the exception for ${tag}`);
  }
  return problems;
}

describe('the migration journal (drizzle/meta/_journal.json)', () => {
  it('lists every migration once, in order, with a newer when and a chained snapshot', () => {
    const drizzleDir = path.join(process.cwd(), 'drizzle');
    const journal: { entries: JournalEntry[] } = JSON.parse(
      fs.readFileSync(path.join(drizzleDir, 'meta/_journal.json'), 'utf8')
    );
    const sqlTags = fs
      .readdirSync(drizzleDir)
      .filter((file) => file.endsWith('.sql'))
      .map((file) => file.slice(0, -'.sql'.length));
    const snapshots = new Map<number, Snapshot>();
    for (const file of fs.readdirSync(path.join(drizzleDir, 'meta'))) {
      const match = file.match(/^(\d{4})_snapshot\.json$/);
      if (match) {
        snapshots.set(
          Number(match[1]),
          JSON.parse(fs.readFileSync(path.join(drizzleDir, 'meta', file), 'utf8'))
        );
      }
    }

    const problems = journalProblems(journal.entries, sqlTags, snapshots, EXCEPTIONS);
    expect(problems, problems.length > 0 ? FIX : undefined).toEqual([]);
  });
});

describe('journalProblems', () => {
  const none: Exceptions = { whenOutOfOrder: [], sqlOutsideJournal: [] };
  const entry = (idx: number, name: string, when: number): JournalEntry => ({
    idx,
    tag: `${String(idx).padStart(4, '0')}_${name}`,
    when,
  });
  const chain = (count: number): Map<number, Snapshot> =>
    new Map(
      Array.from({ length: count }, (_, idx) => [idx, { id: `s${idx}`, prevId: `s${idx - 1}` }])
    );

  it('passes a clean journal', () => {
    const entries = [entry(0, 'a', 1), entry(1, 'b', 2)];
    expect(journalProblems(entries, ['0000_a', '0001_b'], chain(2), none)).toEqual([]);
  });

  it('finds two branches that took the same number', () => {
    const entries = [entry(0, 'a', 1), entry(1, 'site_visits', 2), entry(1, 'deals', 3)];
    const problems = journalProblems(
      entries,
      ['0000_a', '0001_site_visits', '0001_deals'],
      chain(2),
      none
    );
    expect(problems).toContain('entry 2 has idx 1 (numbers must be 0, 1, 2, ...)');
  });

  it('finds a when that the migrator would skip', () => {
    const entries = [entry(0, 'a', 5), entry(1, 'b', 4)];
    expect(journalProblems(entries, ['0000_a', '0001_b'], chain(2), none)).toEqual([
      '0001_b has a when that is not newer than an earlier migration',
    ]);
    expect(
      journalProblems(entries, ['0000_a', '0001_b'], chain(2), {
        ...none,
        whenOutOfOrder: ['0001_b'],
      })
    ).toEqual([]);
  });

  it('finds a snapshot generated on top of another branch', () => {
    const snapshots = chain(3);
    snapshots.set(2, { id: 's2', prevId: 'from-another-branch' });
    const entries = [entry(0, 'a', 1), entry(1, 'b', 2), entry(2, 'c', 3)];
    expect(journalProblems(entries, ['0000_a', '0001_b', '0002_c'], snapshots, none)).toEqual([
      '0002_snapshot.json does not follow the previous snapshot (prevId)',
    ]);
  });

  it('finds SQL files and journal entries without a partner', () => {
    const entries = [entry(0, 'a', 1), entry(1, 'b', 2)];
    expect(journalProblems(entries, ['0000_a', '0001_extra'], chain(2), none)).toEqual([
      'drizzle/0001_extra.sql is not in the journal',
      'the journal lists 0001_b but drizzle/0001_b.sql is missing',
    ]);
  });
});
