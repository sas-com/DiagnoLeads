/**
 * Lead activity timeline and the audit rows of staff updates (#101) on a real PostgreSQL:
 * only changed fields are logged, in the same transaction as the update; the timeline merges
 * diagnoses (verified, continuation, unverified), consultations, follow-ups, hearings, comments
 * and staff updates, pages without overlap and never shows another organization's rows.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55433/dl_test \
 *     bunx vitest --run test/unit/integration/lead-activity.db.test.ts
 */
import * as schema from '@/lib/db/schema';
import {
  auditLogs,
  diagnosticSubmissions,
  emailSuppressions,
  leadComments,
  leads,
  organizationMembers,
  organizations,
  respondentEmailConsents,
  respondentEmailSends,
  users,
} from '@/lib/db/schema';
import type { LeadActivityCursor } from '@/lib/features/lead-activity/types/schemas';
import { appRouter } from '@/server/routers/_app';
import { and, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('lead activity (PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 2 }) : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const pg = (client ? drizzle(client, { schema }) : null)!;
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const organizationIds: string[] = [];
  const userIds: string[] = [];
  let orgA: string;
  let orgB: string;
  // biome-ignore lint/suspicious/noExplicitAny: tRPC caller
  let adminA: any;
  // biome-ignore lint/suspicious/noExplicitAny: tRPC caller
  let viewerA: any;
  // biome-ignore lint/suspicious/noExplicitAny: tRPC caller
  let adminB: any;
  let adminAUser: { id: string };

  async function createOrganization(name: string) {
    const [org] = await pg
      .insert(organizations)
      .values({ name, slug: `activity-${unique()}` })
      .returning();
    organizationIds.push(org.id);
    return org.id;
  }

  // biome-ignore lint/suspicious/noExplicitAny: test database wrapper
  function callerWithDb(db: any, user: unknown) {
    return appRouter.createCaller({
      db,
      // biome-ignore lint/suspicious/noExplicitAny: test context
      session: { session: { id: 's', userId: (user as any).id }, user },
      user,
      // biome-ignore lint/suspicious/noExplicitAny: test context
    } as any);
  }

  async function callerFor(organizationId: string, role: schema.OrganizationRole, name: string) {
    const [user] = await pg
      .insert(users)
      .values({ email: `activity-${unique()}@example.com`, name })
      .returning();
    userIds.push(user.id);
    await pg.insert(organizationMembers).values({ organizationId, userId: user.id, role });
    return { caller: callerWithDb(pg, user), user };
  }

  const auditRowsOf = (leadId: string) =>
    pg
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.resource, 'lead'), eq(auditLogs.resourceId, leadId)));

  beforeAll(async () => {
    orgA = await createOrganization('活動履歴テストA株式会社');
    orgB = await createOrganization('活動履歴テストB株式会社');
    const a = await callerFor(orgA, 'admin', '営業 一郎');
    adminA = a.caller;
    adminAUser = a.user;
    viewerA = (await callerFor(orgA, 'parent_viewer', '閲覧 二郎')).caller;
    adminB = (await callerFor(orgB, 'admin', '別組織 三郎')).caller;
  });

  afterAll(async () => {
    for (const id of organizationIds) {
      await pg.delete(organizations).where(eq(organizations.id, id));
    }
    if (userIds.length > 0) await pg.delete(users).where(inArray(users.id, userIds));
    await client?.end();
  });

  describe('audit rows of staff changes', () => {
    it('logs creation, then only the changed fields, and nothing when nothing changed', async () => {
      const lead = await adminA.leads.create({
        organizationId: orgA,
        email: `lead-${unique()}@example.com`,
        name: '山田 花子',
        company: '架空商事',
        status: 'new',
        inflowSource: 'seminar',
      });
      let rows = await auditRowsOf(lead.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        organizationId: orgA,
        userId: adminAUser.id,
        action: 'create',
        changes: { after: { status: 'new', inflowSource: 'seminar' } },
      });
      // No contact details in the creation record
      expect(rows[0].changes?.after).not.toHaveProperty('email');

      await adminA.leads.update({
        organizationId: orgA,
        id: lead.id,
        status: 'negotiating',
        dealPhase: 'proposal',
        // Sent unchanged: must not be logged
        name: '山田 花子',
        inflowSource: 'seminar',
      });
      rows = await auditRowsOf(lead.id);
      const update = rows.find((row) => row.action === 'update');
      expect(rows).toHaveLength(2);
      expect(update?.changes).toEqual({
        before: { status: 'new', dealPhase: null },
        after: { status: 'negotiating', dealPhase: 'proposal' },
      });

      await adminA.leads.update({
        organizationId: orgA,
        id: lead.id,
        status: 'negotiating',
        name: '山田 花子',
      });
      expect(await auditRowsOf(lead.id)).toHaveLength(2);

      await adminA.leads.bulkUpdateStatus({ organizationId: orgA, ids: [lead.id], status: 'won' });
      await adminA.leads.bulkUpdateStatus({ organizationId: orgA, ids: [lead.id], status: 'won' });
      rows = await auditRowsOf(lead.id);
      expect(rows).toHaveLength(3);
      expect(rows.filter((row) => row.action === 'update').map((row) => row.changes)).toContainEqual(
        { before: { status: 'negotiating' }, after: { status: 'won' } }
      );

      await adminA.leads.delete({ organizationId: orgA, id: lead.id });
      rows = await auditRowsOf(lead.id);
      expect(rows.find((row) => row.action === 'delete')?.changes).toEqual({
        before: { name: '山田 花子', company: '架空商事' },
      });
    });

    it('rolls the update back when the audit row cannot be written (same transaction)', async () => {
      const lead = await adminA.leads.create({
        organizationId: orgA,
        email: `lead-${unique()}@example.com`,
        status: 'new',
      });
      // A database whose transactions refuse audit inserts, after the lead update ran
      const failingDb = new Proxy(pg, {
        get(target, prop, receiver) {
          if (prop !== 'transaction') return Reflect.get(target, prop, receiver);
          return (fn: (tx: unknown) => Promise<unknown>) =>
            target.transaction((tx) =>
              fn(
                new Proxy(tx, {
                  get(t, p, r) {
                    if (p === 'insert') {
                      return (table: unknown) => {
                        if (table === auditLogs) throw new Error('audit insert failed');
                        return t.insert(table as typeof leads);
                      };
                    }
                    const value = Reflect.get(t, p, r);
                    return typeof value === 'function' ? value.bind(t) : value;
                  },
                })
              )
            );
        },
      });
      const failing = callerWithDb(failingDb, adminAUser);

      await expect(
        failing.leads.update({ organizationId: orgA, id: lead.id, status: 'lost' })
      ).rejects.toThrow('audit insert failed');

      const [stored] = await pg.select().from(leads).where(eq(leads.id, lead.id));
      expect(stored.status).toBe('new');
      expect((await auditRowsOf(lead.id)).map((row) => row.action)).toEqual(['create']);
    });

    it('writes no audit row when the update fails', async () => {
      await expect(
        adminA.leads.update({
          organizationId: orgA,
          id: '00000000-0000-4000-8000-000000000000',
          status: 'lost',
        })
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(await auditRowsOf('00000000-0000-4000-8000-000000000000')).toHaveLength(0);
    });
  });

  describe('timeline', () => {
    let leadId: string;
    let first: string;
    let second: string;
    let stranger: string;
    const t0 = new Date('2026-10-01T01:00:00Z');
    const t1 = new Date('2026-10-01T01:10:00Z');
    const t2 = new Date('2026-10-05T03:00:00Z');

    const result = {
      platform: 'as400',
      difficulty: { score: 60, level: 'high' },
      urgency: { score: 40, level: 'medium' },
      challenges: { primary: 'people', selected: ['people'] },
      needsHearing: false,
    };

    beforeAll(async () => {
      const [lead] = await pg
        .insert(leads)
        .values({
          organizationId: orgA,
          email: `web-${unique()}@example.com`,
          name: '佐藤 次郎',
          source: 'website',
          mqlQualifiedAt: t0,
          // Reached before any audit row existed: shown from the lead's own date
          dealPhaseReachedAt: { simple_diagnosis: '2026-10-02' },
          createdAt: t0,
          updatedAt: t0,
        })
        .returning();
      leadId = lead.id;

      const insertSubmission = async (values: Partial<typeof diagnosticSubmissions.$inferInsert>) => {
        const [row] = await pg
          .insert(diagnosticSubmissions)
          .values({
            organizationId: orgA,
            leadId,
            leadCreated: false,
            diagnosticKey: 'ax-migration',
            diagnosticVersion: 2,
            answers: { platform: 'as400', maintenance: 'retiring' },
            result,
            ...values,
          })
          .returning();
        return row.id;
      };
      first = await insertSubmission({
        leadCreated: true,
        answers: { platform: 'as400', maintenance: 'retiring', business_areas: ['sales'] },
        consultationRequestedAt: t0,
        createdAt: t0,
      });
      second = await insertSubmission({
        continuedFromSubmissionId: first,
        consultationRequestedAt: new Date(t1.getTime() + 2 * 60_000),
        createdAt: t1,
      });
      stranger = await insertSubmission({
        answers: { platform: 'acos', business_areas: ['hr'] },
        result: { ...result, platform: 'acos' },
        createdAt: t2,
      });
      await pg
        .update(leads)
        .set({
          responses: {
            axMigration: {
              submissionId: first,
              detailsAnsweredAt: new Date(t0.getTime() + 5 * 60_000).toISOString(),
            },
          },
        })
        .where(eq(leads.id, leadId));

      // Rows of another organization pointing at this lead must never show
      await pg.insert(diagnosticSubmissions).values({
        organizationId: orgB,
        leadId,
        diagnosticKey: 'ax-migration',
        diagnosticVersion: 2,
        answers: {},
        result: {},
        createdAt: t2,
      });
      await pg.insert(auditLogs).values({
        organizationId: orgB,
        action: 'update',
        resource: 'lead',
        resourceId: leadId,
        changes: { before: { status: 'new' }, after: { status: 'lost' } },
      });

      await adminA.leadHearings.create({ organizationId: orgA, leadId, heldOn: '2026-10-06' });
      await pg.insert(leadComments).values({
        organizationId: orgA,
        leadId,
        userId: adminAUser.id,
        content: '架空のメモ',
        type: 'note',
      });
      await adminA.leads.update({
        organizationId: orgA,
        id: leadId,
        dealPhase: 'initial_hearing',
        sqlDecision: 'qualified',
      });
    });

    const listAll = async (caller = adminA, extra: Record<string, unknown> = {}) =>
      (await caller.leadActivity.list({ organizationId: orgA, leadId, limit: 100, ...extra }))
        .items;

    it('merges every source, newest first, with flags and actors', async () => {
      const items = await listAll();
      const kinds = items.map((e: { kind: string }) => e.kind);
      // The SQL judgement and the phase came with the staff update: listed once, as lead_updated
      expect(kinds).toEqual([
        'lead_updated',
        'comment',
        'hearing_recorded',
        'diagnosis_submitted',
        'phase_reached',
        'consultation_requested',
        'diagnosis_submitted',
        'details_answered',
        'consultation_requested',
        'diagnosis_submitted',
        'mql_qualified',
        'lead_created',
      ]);

      const byId = (id: string) => items.find((e: { id: string }) => e.id === id);
      expect(byId(`submission:${stranger}`)).toMatchObject({
        verified: false,
        continuation: false,
        summary: { platform: 'acos', detailsAnswered: true },
      });
      // No recorded time for an unverified respondent's follow-ups
      expect(byId(`submission:${stranger}:details`)).toBeUndefined();
      expect(byId(`submission:${second}`)).toMatchObject({ verified: true, continuation: true });
      expect(byId(`submission:${first}`)).toMatchObject({
        verified: true,
        continuation: false,
        summary: { platform: 'as400', difficulty: 'high', urgency: 'medium', primaryChallenge: 'people' },
      });
      expect(byId(`submission:${first}:consultation`)).toMatchObject({ withSubmission: true });
      expect(byId(`submission:${second}:consultation`)).toMatchObject({ withSubmission: false });
      expect(byId(`lead:${leadId}:created`)).toMatchObject({ source: 'web_diagnosis', actor: null });

      const updated = items.find((e: { kind: string }) => e.kind === 'lead_updated');
      expect(updated.actor).toEqual({ id: adminAUser.id, name: '営業 一郎' });
      expect(updated.changes).toEqual([
        { field: 'dealPhase', before: null, after: 'initial_hearing' },
        { field: 'sqlDecision', before: null, after: 'qualified' },
      ]);
      // The staff change is not listed again from the lead's own dates
      expect(byId(`lead:${leadId}:phase:initial_hearing`)).toBeUndefined();
      expect(byId(`lead:${leadId}:phase:simple_diagnosis`)).toMatchObject({ dateOnly: true });
    });

    it('pages without overlap or gaps', async () => {
      const all = await listAll();
      const paged: { id: string }[] = [];
      let cursor: LeadActivityCursor | null = null;
      for (let i = 0; i < 20; i += 1) {
        const page: Awaited<ReturnType<typeof adminA.leadActivity.list>> =
          await adminA.leadActivity.list({ organizationId: orgA, leadId, limit: 4, cursor });
        paged.push(...page.items);
        cursor = page.nextCursor;
        if (!cursor) break;
      }
      expect(paged.map((e) => e.id)).toEqual(all.map((e: { id: string }) => e.id));
    });

    it('filters by kind', async () => {
      const items = await listAll(adminA, { types: ['diagnosis_submitted'] });
      expect(items).toHaveLength(3);
    });

    it('lets a parent viewer read it, and hides it from another organization', async () => {
      expect((await listAll(viewerA)).length).toBeGreaterThan(0);
      await expect(
        adminB.leadActivity.list({ organizationId: orgB, leadId, limit: 10 })
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(
        adminB.leadActivity.list({ organizationId: orgA, leadId, limit: 10 })
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('opens the answers of one submission with labels, scoped to the lead', async () => {
      const answers = await adminA.leadActivity.submissionAnswers({
        organizationId: orgA,
        leadId,
        submissionId: first,
      });
      expect(answers).toMatchObject({ verified: true, summary: { difficulty: 'high' } });
      expect(answers.answers[0]).toMatchObject({
        questionId: 'platform',
        values: [{ value: 'as400', label: { ja: 'AS/400（IBM i）' } }],
      });
      expect(answers.answers.find((a: { questionId: string }) => a.questionId === 'business_areas'))
        .toMatchObject({ detail: true });

      const otherLead = await adminA.leads.create({
        organizationId: orgA,
        email: `other-${unique()}@example.com`,
      });
      await expect(
        adminA.leadActivity.submissionAnswers({
          organizationId: orgA,
          leadId: otherLead.id,
          submissionId: first,
        })
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(
        adminB.leadActivity.submissionAnswers({ organizationId: orgB, leadId, submissionId: first })
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  describe('respondent email (#154)', () => {
    const HOUR = 60 * 60 * 1000;
    const ago = (hours: number) => new Date(Date.now() - hours * HOUR);
    const emailKinds = ['result_email_requested', 'result_email_sent', 'email_unsubscribed'];
    let leadId: string;
    let leadAddress: string;
    let oldAddress: string;
    let confirmedId: string;
    let declinedId: string;
    let expiredId: string;
    let waitingId: string;

    const consentRow = (organizationId: string, email: string, overrides = {}) => ({
      organizationId,
      leadId,
      email,
      purpose: 'ax_result_copy',
      consentVersion: 'test-v1',
      locale: 'ja',
      confirmExpiresAt: new Date(Date.now() + 24 * HOUR),
      ...overrides,
    });

    beforeAll(async () => {
      leadAddress = `mail-${unique()}@example.com`;
      oldAddress = `old-${unique()}@example.com`;
      const lead = await adminA.leads.create({ organizationId: orgA, email: leadAddress });
      leadId = lead.id;

      const inserted = await pg
        .insert(respondentEmailConsents)
        .values([
          consentRow(orgA, leadAddress, {
            createdAt: ago(50),
            confirmedAt: ago(49),
            confirmTokenHash: `hash-${unique()}`,
          }),
          // Declined from an address the lead no longer has
          consentRow(orgA, oldAddress, { createdAt: ago(40), withdrawnAt: ago(39) }),
          consentRow(orgA, leadAddress, { createdAt: ago(30), confirmExpiresAt: ago(6) }),
          consentRow(orgA, leadAddress, { createdAt: ago(1) }),
        ])
        .returning({ id: respondentEmailConsents.id });
      [confirmedId, declinedId, expiredId, waitingId] = inserted.map((row) => row.id);

      await pg.insert(respondentEmailSends).values([
        // A confirmation is not listed
        {
          organizationId: orgA,
          consentId: confirmedId,
          leadId,
          kind: 'confirmation',
          email: leadAddress,
          status: 'sent',
          createdAt: ago(50),
          sentAt: ago(50),
        },
        // The result went out; the retry was refused as its replay: one event
        {
          organizationId: orgA,
          consentId: confirmedId,
          leadId,
          kind: 'result',
          email: leadAddress,
          status: 'sent',
          resendMessageId: 'msg-secret',
          unsubscribeTokenHash: `unsub-${unique()}`,
          createdAt: ago(49),
          sentAt: ago(49),
        },
        {
          organizationId: orgA,
          consentId: confirmedId,
          leadId,
          kind: 'result',
          email: leadAddress,
          status: 'failed',
          errorCode: 'idempotent_replay',
          createdAt: ago(48),
        },
        // A failed result mail did not go out
        {
          organizationId: orgA,
          consentId: expiredId,
          leadId,
          kind: 'result',
          email: leadAddress,
          status: 'failed',
          errorCode: 'send_failed',
          createdAt: ago(29),
        },
      ]);

      await pg.insert(emailSuppressions).values([
        // Matched by the address of the declined request
        {
          organizationId: orgA,
          email: oldAddress,
          reason: 'not_requested',
          source: 'confirm_page',
          createdAt: ago(39),
        },
        // Matched by the lead's current address
        {
          organizationId: orgA,
          email: leadAddress,
          reason: 'unsubscribed',
          source: 'one_click',
          createdAt: ago(2),
        },
        // Another address of the same organization
        {
          organizationId: orgA,
          email: `someone-${unique()}@example.com`,
          reason: 'bounced',
          source: 'resend_webhook',
        },
        // The same address in another organization
        {
          organizationId: orgB,
          email: leadAddress,
          reason: 'complained',
          source: 'resend_webhook',
        },
      ]);

      // Rows of another organization pointing at this lead must never appear
      const [foreignConsent] = await pg
        .insert(respondentEmailConsents)
        .values(consentRow(orgB, leadAddress, { createdAt: ago(3) }))
        .returning({ id: respondentEmailConsents.id });
      await pg.insert(respondentEmailSends).values({
        organizationId: orgB,
        consentId: foreignConsent.id,
        leadId,
        kind: 'result',
        email: leadAddress,
        status: 'sent',
        createdAt: ago(3),
        sentAt: ago(3),
      });
    });

    it('shows each request with its state, one sent result and the suppressions of the lead', async () => {
      const page = await adminA.leadActivity.list({
        organizationId: orgA,
        leadId,
        limit: 50,
        types: emailKinds,
      });
      const items = page.items as Array<Record<string, unknown> & { id: string; kind: string }>;
      expect(items.map((e) => e.kind)).toEqual([
        'result_email_requested', // waiting (1 h ago)
        'email_unsubscribed', // unsubscribed (2 h ago)
        'result_email_requested', // expired (30 h ago)
        'email_unsubscribed', // not requested (39 h ago)
        'result_email_requested', // declined (40 h ago)
        'result_email_sent', // 49 h ago, the replay not listed
        'result_email_requested', // confirmed (50 h ago)
      ]);
      const byId = (id: string) => items.find((e) => e.id === id);
      expect(byId(`email-request:${waitingId}`)).toMatchObject({
        request: { state: 'waiting', at: null },
      });
      expect(byId(`email-request:${expiredId}`)).toMatchObject({ request: { state: 'expired' } });
      expect(byId(`email-request:${declinedId}`)).toMatchObject({
        request: { state: 'declined', notRequested: true },
      });
      expect(byId(`email-request:${confirmedId}`)).toMatchObject({
        request: { state: 'confirmed' },
      });
      expect(byId(`email-sent:${confirmedId}`)).toMatchObject({ consentId: confirmedId });
      expect(items.filter((e) => e.kind === 'email_unsubscribed')).toEqual([
        expect.objectContaining({ reason: 'unsubscribed', source: 'one_click', actor: null }),
        expect.objectContaining({ reason: 'not_requested', source: 'confirm_page' }),
      ]);

      const text = JSON.stringify(items);
      for (const secret of [leadAddress, oldAddress, 'msg-secret', 'idempotent_replay', 'hash-']) {
        expect(text).not.toContain(secret);
      }
    });

    it('shows a parent organization viewer the suppressions without their reasons (#365)', async () => {
      const page = await viewerA.leadActivity.list({
        organizationId: orgA,
        leadId,
        limit: 50,
        types: emailKinds,
      });
      const items = page.items as Array<Record<string, unknown> & { kind: string }>;
      expect(items.filter((e) => e.kind === 'email_unsubscribed')).toEqual([
        expect.objectContaining({ reason: null, source: null, actor: null }),
        expect.objectContaining({ reason: null, source: null, actor: null }),
      ]);
      expect(items.find((e) => e.id === `email-request:${declinedId}`)).toMatchObject({
        request: { state: 'declined', notRequested: false },
      });
    });

    it('never shows the rows of another organization', async () => {
      await expect(
        adminB.leadActivity.list({ organizationId: orgB, leadId, limit: 50 })
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      const page = await adminA.leadActivity.list({
        organizationId: orgA,
        leadId,
        limit: 50,
        types: emailKinds,
      });
      expect(page.items).toHaveLength(7);
      expect(page.items.some((e: { reason?: string }) => e.reason === 'complained')).toBe(false);
      expect(page.items.some((e: { reason?: string }) => e.reason === 'bounced')).toBe(false);
    });
  });
});
