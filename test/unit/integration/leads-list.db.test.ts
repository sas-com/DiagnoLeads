/**
 * Lead list sorting, filtering and paging on a real PostgreSQL (#131): every sort key in both
 * directions, every filter, combinations, page totals, and no rows of another organization.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55433/dl_test \
 *     bunx vitest --run test/unit/integration/leads-list.db.test.ts
 */
import * as schema from '@/lib/db/schema';
import { leadHearings, leads, organizationMembers, organizations, users } from '@/lib/db/schema';
import type { LeadSortKey } from '@/lib/features/leads/types/schemas';
import { appRouter } from '@/server/routers/_app';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));

const url = process.env.TEST_DATABASE_URL;

type Label = 'L1' | 'L2' | 'L3' | 'L4' | 'L5';

describe.skipIf(!url)('lead list (PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 2 }) : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const pg = (client ? drizzle(client, { schema }) : null)!;
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const organizationIds: string[] = [];
  const userIds: string[] = [];
  let orgA: string;
  let orgB: string;
  // biome-ignore lint/suspicious/noExplicitAny: tRPC caller
  let callerA: any;
  // biome-ignore lint/suspicious/noExplicitAny: tRPC caller
  let callerB: any;
  const labelOf = new Map<string, Label>();
  let otherOrgLeadId: string;
  const at = (iso: string) => new Date(iso);

  async function createOrganization(name: string) {
    const [org] = await pg
      .insert(organizations)
      .values({ name, slug: `list-${unique()}` })
      .returning();
    organizationIds.push(org.id);
    return org.id;
  }

  async function callerFor(organizationId: string) {
    const [user] = await pg
      .insert(users)
      .values({ email: `list-${unique()}@example.com`, name: '一覧 太郎' })
      .returning();
    userIds.push(user.id);
    await pg.insert(organizationMembers).values({ organizationId, userId: user.id, role: 'admin' });
    return appRouter.createCaller({
      db: pg,
      session: { session: { id: 's', userId: user.id }, user },
      user,
      // biome-ignore lint/suspicious/noExplicitAny: test context
    } as any);
  }

  async function insertLead(label: Label | null, values: Partial<typeof leads.$inferInsert>) {
    const [row] = await pg
      .insert(leads)
      .values({
        organizationId: orgA,
        email: `${(label ?? 'other').toLowerCase()}-${unique()}@example.com`,
        status: 'new',
        ...values,
      })
      .returning();
    if (label) labelOf.set(row.id, label);
    return row;
  }

  /** Labels of the listed leads, in order */
  async function list(input: Record<string, unknown> = {}): Promise<Label[]> {
    const result = await callerA.leads.list({ organizationId: orgA, limit: 100, ...input });
    return result.items.map((item: { id: string }) => labelOf.get(item.id) ?? item.id);
  }
  const sorted = (labels: Label[]) => [...labels].sort();

  beforeAll(async () => {
    orgA = await createOrganization('一覧テストA株式会社');
    orgB = await createOrganization('一覧テストB株式会社');
    callerA = await callerFor(orgA);
    callerB = await callerFor(orgB);

    await insertLead('L1', {
      name: 'あおき',
      company: 'Alpha',
      status: 'new',
      score: 80,
      inflowSource: 'seminar',
      targetSystem: 'as400',
      conversionPoint: 'consultation',
      mqlQualifiedAt: at('2026-10-10T00:00:00Z'),
      createdAt: at('2026-10-12T15:00:00Z'), // 10/13 00:00 JST
      updatedAt: at('2026-10-12T15:00:00Z'),
    });
    await insertLead('L2', {
      name: 'いのうえ',
      company: 'Beta',
      status: 'nurturing',
      score: 40,
      inflowSource: 'lp_organic',
      dealPhase: 'initial_hearing',
      targetSystem: 'vb',
      conversionPoint: 'web_diagnosis',
      sqlDecision: 'not_qualified',
      createdAt: at('2026-10-12T14:59:59Z'), // 10/12 23:59:59 JST
      updatedAt: at('2026-10-14T00:00:00Z'),
    });
    const l3 = await insertLead('L3', {
      name: 'うえだ',
      status: 'negotiating',
      inflowSource: 'referral_partner',
      dealPhase: 'proposal',
      targetSystem: 'as400',
      mqlQualifiedAt: at('2026-10-05T00:00:00Z'),
      sqlDecision: 'qualified',
      createdAt: at('2026-10-01T00:00:00Z'),
      updatedAt: at('2026-10-02T00:00:00Z'),
    });
    await insertLead('L4', {
      company: 'Gamma 100%',
      status: 'won',
      score: 95,
      inflowSource: 'seminar',
      dealPhase: 'survey_won',
      targetSystem: 'access',
      conversionPoint: 'consultation',
      mqlQualifiedAt: at('2026-10-01T00:00:00Z'),
      sqlDecision: 'qualified',
      createdAt: at('2026-09-20T00:00:00Z'),
      updatedAt: at('2026-09-21T00:00:00Z'),
    });
    await insertLead('L5', {
      name: 'えのもと',
      company: 'Delta',
      status: 'lost',
      score: 10,
      inflowSource: 'advertising',
      targetSystem: 'other',
      createdAt: at('2026-10-16T00:00:00Z'),
      updatedAt: at('2026-10-16T00:00:00Z'),
    });
    // A hearing saved after the lead's own last update: L3's last activity
    await pg.insert(leadHearings).values({
      organizationId: orgA,
      leadId: l3.id,
      heldOn: '2026-10-15',
      catalogVersion: 1,
      createdAt: at('2026-10-15T12:00:00Z'),
      updatedAt: at('2026-10-15T12:00:00Z'),
    });

    // Another organization: a lead that matches every filter used below
    const [other] = await pg
      .insert(leads)
      .values({
        organizationId: orgB,
        email: `l1-other-${unique()}@example.com`,
        name: 'あおき',
        company: 'Alpha Beta Gamma 100%',
        status: 'new',
        score: 85,
        inflowSource: 'seminar',
        dealPhase: 'proposal',
        targetSystem: 'as400',
        conversionPoint: 'consultation',
        mqlQualifiedAt: at('2026-10-10T00:00:00Z'),
        sqlDecision: 'qualified',
        createdAt: at('2026-10-13T00:00:00Z'),
        updatedAt: at('2026-10-17T00:00:00Z'),
      })
      .returning();
    otherOrgLeadId = other.id;
  });

  afterAll(async () => {
    if (organizationIds.length > 0) {
      await pg.delete(organizations).where(inArray(organizations.id, organizationIds));
    }
    if (userIds.length > 0) await pg.delete(users).where(inArray(users.id, userIds));
    await client?.end();
  });

  describe('sorting', () => {
    const cases: [LeadSortKey, Label[], Label[]][] = [
      // [key, ascending, descending]; empty values always last
      ['createdAt', ['L4', 'L3', 'L2', 'L1', 'L5'], ['L5', 'L1', 'L2', 'L3', 'L4']],
      ['updatedAt', ['L4', 'L3', 'L1', 'L2', 'L5'], ['L5', 'L2', 'L1', 'L3', 'L4']],
      ['name', ['L1', 'L2', 'L3', 'L5', 'L4'], ['L5', 'L3', 'L2', 'L1', 'L4']],
      ['email', ['L1', 'L2', 'L3', 'L4', 'L5'], ['L5', 'L4', 'L3', 'L2', 'L1']],
      ['company', ['L1', 'L2', 'L5', 'L4', 'L3'], ['L4', 'L5', 'L2', 'L1', 'L3']],
      ['score', ['L5', 'L2', 'L1', 'L4', 'L3'], ['L4', 'L1', 'L2', 'L5', 'L3']],
      // Pipeline order, not alphabetical
      ['status', ['L1', 'L2', 'L3', 'L4', 'L5'], ['L5', 'L4', 'L3', 'L2', 'L1']],
      // No phase: last, newest first among them
      ['dealPhase', ['L2', 'L3', 'L4', 'L5', 'L1'], ['L4', 'L3', 'L2', 'L5', 'L1']],
      // L3's hearing (10/15) is later than its own update (10/2)
      ['lastActivityAt', ['L4', 'L1', 'L2', 'L3', 'L5'], ['L5', 'L3', 'L2', 'L1', 'L4']],
      ['mqlQualifiedAt', ['L4', 'L3', 'L1', 'L5', 'L2'], ['L1', 'L3', 'L4', 'L5', 'L2']],
    ];
    it.each(cases)('sorts by %s', async (sortBy, ascending, descending) => {
      expect(await list({ sortBy, sortOrder: 'asc' })).toEqual(ascending);
      expect(await list({ sortBy, sortOrder: 'desc' })).toEqual(descending);
    });

    it('defaults to newest first', async () => {
      expect(await list()).toEqual(['L5', 'L1', 'L2', 'L3', 'L4']);
    });

    it('returns the last activity time with each lead', async () => {
      const result = await callerA.leads.list({ organizationId: orgA, sortBy: 'lastActivityAt' });
      const l3 = result.items.find((item: { id: string }) => labelOf.get(item.id) === 'L3');
      const l5 = result.items.find((item: { id: string }) => labelOf.get(item.id) === 'L5');
      expect(l3.lastActivityAt).toEqual(at('2026-10-15T12:00:00Z'));
      expect(l5.lastActivityAt).toEqual(at('2026-10-16T00:00:00Z'));
    });
  });

  describe('filters', () => {
    const cases: [string, Record<string, unknown>, Label[]][] = [
      ['one status', { status: 'won' }, ['L4']],
      ['several statuses', { status: ['new', 'lost'] }, ['L1', 'L5']],
      ['deal phases', { dealPhase: ['proposal', 'survey_won'] }, ['L3', 'L4']],
      ['inflow sources', { inflowSource: ['seminar'] }, ['L1', 'L4']],
      ['target systems', { targetSystem: ['as400', 'other'] }, ['L1', 'L3', 'L5']],
      ['score range', { scoreMin: 40, scoreMax: 80 }, ['L1', 'L2']],
      ['minimum score', { scoreMin: 90 }, ['L4']],
      // JST days: L1 was created at 10/13 00:00 JST, L2 at 10/12 23:59:59 JST
      ['created from a day', { createdFromDay: '2026-10-13' }, ['L1', 'L5']],
      ['created up to a day', { createdToDay: '2026-10-12' }, ['L2', 'L3', 'L4']],
      ['created on one day', { createdFromDay: '2026-10-12', createdToDay: '2026-10-12' }, ['L2']],
      ['consultation requested', { consultationRequested: true }, ['L1', 'L4']],
      ['no consultation', { consultationRequested: false }, ['L2', 'L3', 'L5']],
      ['MQL', { mql: true }, ['L1', 'L3', 'L4']],
      ['not MQL', { mql: false }, ['L2', 'L5']],
      ['SQL', { sqlDecision: 'qualified' }, ['L3', 'L4']],
      ['not SQL', { sqlDecision: 'not_qualified' }, ['L2']],
      ['SQL undecided', { sqlDecision: 'undecided' }, ['L1', 'L5']],
      ['search company, any case', { search: 'beta' }, ['L2']],
      ['search name', { search: 'いのう' }, ['L2']],
      ['search email', { search: 'l3-' }, ['L3']],
      // LIKE wildcards are searched as text
      ['search a percent sign', { search: '%' }, ['L4']],
      ['search an underscore', { search: '_' }, []],
    ];
    it.each(cases)('filters by %s', async (_name, input, expected) => {
      expect(sorted(await list(input))).toEqual(expected);
    });

    it('combines filters (all must match)', async () => {
      expect(
        await list({ status: ['new', 'won'], consultationRequested: true, scoreMin: 90 })
      ).toEqual(['L4']);
      expect(
        await list({ inflowSource: ['seminar'], mql: true, sortBy: 'score', sortOrder: 'asc' })
      ).toEqual(['L1', 'L4']);
      expect(
        await list({ targetSystem: ['as400'], sqlDecision: 'qualified', search: 'うえ' })
      ).toEqual(['L3']);
      expect(await list({ status: ['new'], dealPhase: ['proposal'] })).toEqual([]);
    });
  });

  describe('paging', () => {
    it('pages without overlap and reports the total of all matching leads', async () => {
      const pages = [];
      for (const offset of [0, 2, 4]) {
        const result = await callerA.leads.list({ organizationId: orgA, limit: 2, offset });
        expect(result.total).toBe(5);
        pages.push(result.items.map((item: { id: string }) => labelOf.get(item.id)));
      }
      expect(pages).toEqual([['L5', 'L1'], ['L2', 'L3'], ['L4']]);
    });

    it('counts only the filtered leads', async () => {
      const result = await callerA.leads.list({ organizationId: orgA, mql: true, limit: 1 });
      expect(result.total).toBe(3);
      expect(result.items).toHaveLength(1);
      const empty = await callerA.leads.list({ organizationId: orgA, status: ['won'], offset: 5 });
      expect(empty.total).toBe(1);
      expect(empty.items).toEqual([]);
    });
  });

  describe('organizations', () => {
    it('never lists or counts another organization’s leads', async () => {
      const filters = [
        {},
        { search: 'あおき' },
        { status: ['new'], inflowSource: ['seminar'], consultationRequested: true, mql: true },
        { sortBy: 'updatedAt', sortOrder: 'desc' },
      ];
      for (const input of filters) {
        const result = await callerA.leads.list({ organizationId: orgA, ...input });
        expect(result.items.map((item: { id: string }) => item.id)).not.toContain(otherOrgLeadId);
        expect(result.items.every((item: { organizationId: string }) => item.organizationId === orgA)).toBe(true);
      }
      const all = await callerA.leads.list({ organizationId: orgA });
      expect(all.total).toBe(5);

      const b = await callerB.leads.list({ organizationId: orgB, search: 'あおき' });
      expect(b.total).toBe(1);
      expect(b.items[0].id).toBe(otherOrgLeadId);
    });

    it('refuses to list an organization the user does not belong to', async () => {
      await expect(callerA.leads.list({ organizationId: orgB })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });
  });

  describe('status counts (the list page cards)', () => {
    it('counts the whole organization, whatever the list filters', async () => {
      const a = await callerA.leads.statusCounts({ organizationId: orgA });
      expect(a).toEqual({
        total: 5,
        byStatus: { new: 1, nurturing: 1, negotiating: 1, won: 1, lost: 1 },
      });
      const b = await callerB.leads.statusCounts({ organizationId: orgB });
      expect(b).toEqual({
        total: 1,
        byStatus: { new: 1, nurturing: 0, negotiating: 0, won: 0, lost: 0 },
      });
      await expect(callerA.leads.statusCounts({ organizationId: orgB })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });
  });

  describe('MQL level (#196)', () => {
    it('reads the level from the stored diagnosis summaries, like the lead page', async () => {
      // An organization of its own, so the fixture counts above stay as they are
      const orgC = await createOrganization('一覧テストC株式会社');
      const callerC = await callerFor(orgC);
      const cases: [string, Record<string, unknown>, string | null][] = [
        ['ax-interest', { axMigration: { mql: { level: 'interest' }, mqlCandidate: true } }, 'interest'],
        ['ax-fit', { axMigration: { mql: { level: 'fit' } } }, 'fit'],
        ['ax-none', { axMigration: { mql: { level: 'none' }, mqlCandidate: true } }, 'none'],
        // Judged before 2026-10-16 (#139): only mqlCandidate
        ['ax-legacy-fit', { axMigration: { mqlCandidate: true } }, 'fit'],
        ['ax-legacy-none', { axMigration: { mqlCandidate: false } }, 'none'],
        ['ax-broken-level', { axMigration: { mql: { level: 'hot' }, mqlCandidate: true } }, 'fit'],
        ['builder-fit', { diagnosis: { mqlLevel: 'fit', mqlQualified: false } }, 'fit'],
        ['builder-qualified', { diagnosis: { mqlQualified: true } }, 'interest'],
        ['both', { axMigration: { mqlCandidate: true }, diagnosis: { mqlLevel: 'interest' } }, 'interest'],
        ['none', {}, null],
        ['not-an-object', { axMigration: 'x', diagnosis: [1] }, null],
      ];
      const nameOf = new Map<string, string>();
      for (const [name, responses] of cases) {
        const [row] = await pg
          .insert(leads)
          .values({
            organizationId: orgC,
            email: `${name}-${unique()}@example.com`,
            status: 'new',
            responses,
            // A hand-set MQL date does not change the level
            mqlQualifiedAt: name === 'none' ? at('2026-10-10T00:00:00Z') : null,
          })
          .returning();
        nameOf.set(row.id, name);
      }

      const result = await callerC.leads.list({ organizationId: orgC, limit: 100 });
      const levels = Object.fromEntries(
        result.items.map((item: { id: string; mqlLevel: string | null }) => [
          nameOf.get(item.id),
          item.mqlLevel,
        ])
      );
      expect(levels).toEqual(Object.fromEntries(cases.map(([name, , level]) => [name, level])));

      // The MQL filter stays on the MQL date
      const mql = await callerC.leads.list({ organizationId: orgC, mql: true });
      expect(mql.items.map((item: { id: string }) => nameOf.get(item.id))).toEqual(['none']);
    });

    it('filters and sorts by the level, 関心あり first and leads without a diagnosis last (#447)', async () => {
      const orgD = await createOrganization('一覧テストD株式会社');
      const callerD = await callerFor(orgD);
      const responsesOf: Record<string, Record<string, unknown>> = {
        interest: { axMigration: { mql: { level: 'interest' } } },
        fit: { axMigration: { mql: { level: 'fit' } } },
        none: { axMigration: { mql: { level: 'none' } } },
        unknown: {},
      };
      const nameOf = new Map<string, string>();
      // Inserted in an order that differs from the level order
      for (const name of ['unknown', 'fit', 'none', 'interest']) {
        const [row] = await pg
          .insert(leads)
          .values({
            organizationId: orgD,
            email: `${name}-${unique()}@example.com`,
            responses: responsesOf[name],
          })
          .returning();
        nameOf.set(row.id, name);
      }
      const names = (items: { id: string }[]) => items.map((item) => nameOf.get(item.id));

      const sorted = await callerD.leads.list({ organizationId: orgD, sortBy: 'mqlLevel', sortOrder: 'asc' });
      expect(names(sorted.items)).toEqual(['interest', 'fit', 'none', 'unknown']);
      const reversed = await callerD.leads.list({ organizationId: orgD, sortBy: 'mqlLevel', sortOrder: 'desc' });
      expect(names(reversed.items)).toEqual(['none', 'fit', 'interest', 'unknown']);

      const fitOrUnknown = await callerD.leads.list({ organizationId: orgD, mqlLevel: ['fit', 'unknown'] });
      expect(names(fitOrUnknown.items).sort()).toEqual(['fit', 'unknown']);
      const interest = await callerD.leads.list({ organizationId: orgD, mqlLevel: 'interest' });
      expect(names(interest.items)).toEqual(['interest']);
    });
  });

  it('has exactly the five fixture leads in the organization', async () => {
    // Sanity: the fixture rows are where the test expects them
    const rows = await pg.select({ id: leads.id }).from(leads).where(eq(leads.organizationId, orgA));
    expect(rows).toHaveLength(5);
  });
});
