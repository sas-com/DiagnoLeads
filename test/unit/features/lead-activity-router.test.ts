/**
 * leadActivity router: merge order, pagination, kind filter, the duplicate rule for the lead's
 * own dates, identity flags of diagnoses, organization scoping and who may read (Refs #101).
 * Uses the real CASL abilities; the database is a fake that answers each awaited query with the
 * next queued result. The DB behaviour itself is covered by
 * test/unit/integration/lead-activity.db.test.ts.
 */
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));
// The router must use ctx.db; the global client is left empty so a stray use fails
vi.mock('@/lib/db/client', () => ({ db: {} }));

const { dbState } = vi.hoisted(() => ({
  dbState: { results: [] as unknown[][], queries: 0, wheres: [] as unknown[] },
}));

/** A query builder: every method returns itself; awaiting it yields the next queued result */
function query() {
  dbState.queries += 1;
  const promise = Promise.resolve().then(() => dbState.results.shift() ?? []);
  const builder: Promise<unknown[]> & Record<string, (arg?: unknown) => unknown> = Object.assign(
    promise,
    {
      from: () => builder,
      leftJoin: () => builder,
      orderBy: () => builder,
      limit: () => builder,
      where: (arg: unknown) => {
        dbState.wheres.push(arg);
        return builder;
      },
    }
  );
  return builder;
}

const fakeDb = { select: query };

const { appRouter } = await import('@/server/routers/_app');

const USER_ID = '550e8400-e29b-41d4-a716-446655440000';
const STAFF_ID = '550e8400-e29b-41d4-a716-446655440009';
const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const LEAD_ID = '770e8400-e29b-41d4-a716-446655440001';
const SUB_1 = '880e8400-e29b-41d4-a716-446655440001';
const SUB_2 = '880e8400-e29b-41d4-a716-446655440002';
const SUB_3 = '880e8400-e29b-41d4-a716-446655440003';
const AUDIT_ID = '990e8400-e29b-41d4-a716-446655440001';

function callerAs(role: string | null) {
  const user = {
    id: USER_ID,
    email: 'test@example.com',
    name: 'Test',
    emailVerified: true,
    image: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const membership =
    role === null
      ? undefined
      : {
          id: '770e8400-e29b-41d4-a716-446655440000',
          organizationId: ORG_ID,
          userId: USER_ID,
          role,
          createdAt: new Date(),
          updatedAt: new Date(),
          organization: { id: ORG_ID, name: 'Org', slug: 'org', settings: {} },
        };
  const ctx = {
    db: {
      ...fakeDb,
      query: { organizationMembers: { findFirst: vi.fn().mockResolvedValue(membership) } },
    },
    session: { session: { id: 's', userId: USER_ID }, user },
    user,
  };
  // biome-ignore lint/suspicious/noExplicitAny: test context
  return appRouter.createCaller(ctx as any);
}

const toQuery = (sql: unknown) => new PgDialect().sqlToQuery(sql as SQL);
const at = (iso: string) => new Date(iso);

const T0 = at('2026-10-01T01:00:00.000Z');

const LEAD_EMAIL = 'Hanako@Example.com';

const leadRow = (overrides: Record<string, unknown> = {}) => ({
  id: LEAD_ID,
  email: LEAD_EMAIL,
  source: 'website',
  responses: {
    axMigration: { submissionId: SUB_1, detailsAnsweredAt: '2026-10-01T01:05:00.000Z' },
  },
  mqlQualifiedAt: T0,
  sqlDecision: null,
  sqlDecidedAt: null,
  dealPhaseReachedAt: {},
  createdAt: T0,
  ...overrides,
});

const submission = (overrides: Record<string, unknown>) => ({
  diagnosticKey: 'ax-migration',
  leadCreated: false,
  continuedFromSubmissionId: null,
  consultationRequestedAt: null,
  answers: { platform: 'as400' },
  result: {
    platform: 'as400',
    difficulty: { level: 'high' },
    urgency: { level: 'low' },
    challenges: { primary: 'cost' },
  },
  ...overrides,
});

/** Lead created by the diagnosis, a continuation and an unverified diagnosis */
const submissions = [
  submission({
    id: SUB_3,
    answers: { platform: 'acos', business_areas: ['hr'] },
    createdAt: at('2026-10-05T00:00:00.000Z'),
  }),
  submission({
    id: SUB_2,
    continuedFromSubmissionId: SUB_1,
    consultationRequestedAt: at('2026-10-01T01:20:00.000Z'),
    createdAt: at('2026-10-01T01:10:00.000Z'),
  }),
  submission({ id: SUB_1, leadCreated: true, consultationRequestedAt: T0, createdAt: T0 }),
];

const auditRow = (overrides: Record<string, unknown> = {}) => ({
  id: AUDIT_ID,
  action: 'update',
  userId: STAFF_ID,
  changes: {
    before: { status: 'new', dealPhase: null },
    after: { status: 'negotiating', dealPhase: 'proposal' },
  },
  metadata: null,
  createdAt: at('2026-10-06T00:00:00.000Z'),
  ...overrides,
});

/**
 * Queue: lead, submissions, hearings, comments, audit rows, contact records, result email
 * requests, result sends, suppressions, staff names
 */
function queue(
  options: {
    lead?: Record<string, unknown>;
    submissions?: unknown[];
    hearings?: unknown[];
    comments?: unknown[];
    audits?: unknown[];
    contacts?: unknown[];
    consents?: unknown[];
    sends?: unknown[];
    suppressions?: unknown[];
    users?: unknown[];
  } = {}
) {
  dbState.results = [
    [leadRow(options.lead)],
    options.submissions ?? submissions,
    options.hearings ?? [],
    options.comments ?? [],
    options.audits ?? [],
    options.contacts ?? [],
    options.consents ?? [],
    options.sends ?? [],
    options.suppressions ?? [],
    options.users ?? [{ id: STAFF_ID, name: null, email: 'staff@example.com' }],
  ];
}

const list = (extra: Record<string, unknown> = {}, role = 'member') =>
  callerAs(role).leadActivity.list({ organizationId: ORG_ID, leadId: LEAD_ID, ...extra });

beforeEach(() => {
  dbState.results = [];
  dbState.queries = 0;
  dbState.wheres = [];
});

describe('leadActivity.list', () => {
  it('merges the sources newest first, with identity flags and actor names', async () => {
    queue({
      hearings: [
        {
          id: 'h1',
          heldOn: '2026-10-07',
          createdBy: STAFF_ID,
          updatedBy: STAFF_ID,
          createdAt: at('2026-10-07T00:00:00.000Z'),
          updatedAt: at('2026-10-08T00:00:00.000Z'),
        },
      ],
      comments: [
        {
          id: 'c1',
          type: 'note',
          excerpt: '架空のメモ',
          parentId: null,
          userId: STAFF_ID,
          createdAt: at('2026-10-09T00:00:00.000Z'),
        },
      ],
      audits: [auditRow()],
    });

    const { items, nextCursor } = await list({ limit: 50 });

    expect(items.map((e) => e.kind)).toEqual([
      'comment',
      'hearing_updated',
      'hearing_recorded',
      'lead_updated',
      'diagnosis_submitted',
      'consultation_requested',
      'diagnosis_submitted',
      'details_answered',
      'consultation_requested',
      'diagnosis_submitted',
      'mql_qualified',
      'lead_created',
    ]);
    expect(nextCursor).toBeNull();
    const byId = (id: string) => items.find((e) => e.id === id);
    expect(byId(`submission:${SUB_3}`)).toMatchObject({
      verified: false,
      continuation: false,
      actor: null,
      summary: { platform: 'as400', difficulty: 'high', detailsAnswered: true },
    });
    expect(byId(`submission:${SUB_2}`)).toMatchObject({ verified: true, continuation: true });
    expect(byId(`submission:${SUB_1}`)).toMatchObject({ verified: true, continuation: false });
    expect(byId(`submission:${SUB_1}:consultation`)).toMatchObject({ withSubmission: true });
    expect(byId(`submission:${SUB_2}:consultation`)).toMatchObject({ withSubmission: false });
    expect(byId(`audit:${AUDIT_ID}`)).toMatchObject({
      actor: { id: STAFF_ID, name: 'staff@example.com' },
      changes: [
        { field: 'status', before: 'new', after: 'negotiating' },
        { field: 'dealPhase', before: null, after: 'proposal' },
      ],
    });
    expect(byId(`lead:${LEAD_ID}:created`)).toMatchObject({ source: 'web_diagnosis' });
  });

  it('scopes every query by organization and lead', async () => {
    queue({ audits: [auditRow()] });
    await list({ limit: 10 });

    const [leadWhere, ...sourceWheres] = dbState.wheres;
    expect(toQuery(leadWhere).params).toEqual([LEAD_ID, ORG_ID]);
    // submissions, hearings, comments, audit rows, contact records, result email requests and
    // result sends (staff names are by id)
    for (const where of sourceWheres.slice(0, 7)) {
      const { sql, params } = toQuery(where);
      expect(sql).toContain('"organization_id"');
      expect(params).toContain(ORG_ID);
      expect(params).toContain(LEAD_ID);
    }
  });

  it('lists contact records with the note and actor, marking the earliest as the first contact', async () => {
    queue({
      contacts: [
        {
          id: 'c2',
          kind: 'call',
          note: 'Talked about the schedule',
          createdBy: STAFF_ID,
          contactedAt: at('2026-10-08T00:00:00.000Z'),
        },
        {
          id: 'c1',
          kind: 'no_answer',
          note: null,
          createdBy: STAFF_ID,
          contactedAt: at('2026-10-07T00:00:00.000Z'),
        },
      ],
    });
    const page = await list({ limit: 50, types: ['contact_recorded'] });

    expect(page.items).toEqual([
      expect.objectContaining({
        id: 'contact:c2',
        contactKind: 'call',
        note: 'Talked about the schedule',
        first: false,
        actor: { id: STAFF_ID, name: 'staff@example.com' },
      }),
      expect.objectContaining({ id: 'contact:c1', contactKind: 'no_answer', first: true }),
    ]);
  });

  it('pages by time and id without overlap', async () => {
    const all: string[] = [];
    let cursor: { at: Date; id: string } | null = null;
    for (let i = 0; i < 10; i += 1) {
      queue({ audits: [auditRow()] });
      const page: { items: { id: string }[]; nextCursor: { at: Date; id: string } | null } =
        await list({ limit: 3, cursor });
      expect(page.items.length).toBeLessThanOrEqual(3);
      all.push(...page.items.map((e) => e.id));
      cursor = page.nextCursor;
      if (!cursor) break;
    }
    queue({ audits: [auditRow()] });
    const whole = await list({ limit: 100 });
    expect(all).toEqual(whole.items.map((e) => e.id));
    expect(new Set(all).size).toBe(all.length);
  });

  it('filters by kind', async () => {
    queue();
    const { items } = await list({ limit: 50, types: ['diagnosis_submitted'] });
    expect(items.map((e) => e.id)).toEqual([
      `submission:${SUB_3}`,
      `submission:${SUB_2}`,
      `submission:${SUB_1}`,
    ]);
  });

  it('shows a judgement once: as lead_updated when an audit row recorded it', async () => {
    const decidedAt = at('2026-10-06T00:00:00.000Z');
    queue({
      lead: {
        sqlDecision: 'qualified',
        sqlDecidedAt: decidedAt,
        mqlQualifiedAt: decidedAt,
        dealPhaseReachedAt: { proposal: '2026-10-06', initial_hearing: '2026-10-02' },
      },
      submissions: [],
      audits: [
        auditRow({
          changes: {
            before: { mqlQualified: false, sqlDecision: null, dealPhase: null },
            after: { mqlQualified: true, sqlDecision: 'qualified', dealPhase: 'proposal' },
          },
          createdAt: decidedAt,
        }),
      ],
    });
    const { items } = await list({ limit: 50 });
    expect(items.map((e) => e.kind)).toEqual(['lead_updated', 'phase_reached', 'lead_created']);
    expect(items[1]).toMatchObject({ phase: 'initial_hearing', dateOnly: true });
    expect(items[2]).toMatchObject({ source: 'other' });
  });

  it('keeps the dates from the lead when no audit row matches them', async () => {
    queue({
      lead: { sqlDecision: 'qualified', sqlDecidedAt: at('2026-10-06T00:00:00.000Z') },
      submissions: [],
      audits: [
        auditRow({
          changes: { before: { sqlDecision: null }, after: { sqlDecision: 'qualified' } },
          createdAt: at('2026-10-03T00:00:00.000Z'),
        }),
      ],
    });
    const { items } = await list({ limit: 50 });
    expect(items.map((e) => e.kind)).toEqual([
      'sql_decided',
      'lead_updated',
      'mql_qualified',
      'lead_created',
    ]);
  });

  it('names the staff member who created the lead', async () => {
    queue({
      submissions: [],
      lead: { mqlQualifiedAt: null },
      audits: [auditRow({ action: 'create', changes: { after: { status: 'new' } }, createdAt: T0 })],
      users: [{ id: STAFF_ID, name: '営業 一郎', email: 'staff@example.com' }],
    });
    const { items } = await list({ limit: 50 });
    expect(items).toEqual([
      expect.objectContaining({
        kind: 'lead_created',
        source: 'staff',
        actor: { id: STAFF_ID, name: '営業 一郎' },
      }),
    ]);
  });

  it('reports a lead of another organization as not found', async () => {
    dbState.results = [[]];
    await expect(list({ limit: 10 })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(dbState.queries).toBe(1);
  });

  it.each(['owner', 'admin', 'member', 'group_owner', 'group_admin', 'parent_viewer'])(
    '%s can read the timeline',
    async (role) => {
      queue();
      const { items } = await list({ limit: 5 }, role);
      expect(items).toHaveLength(5);
    }
  );

  it('rejects a user who is not a member of the organization', async () => {
    await expect(list({ limit: 10 }, null as unknown as string)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(dbState.queries).toBe(0);
  });

  it('rejects a page larger than 100', async () => {
    await expect(list({ limit: 101 })).rejects.toThrow();
  });
});

describe('leadActivity.list: respondent email (#154)', () => {
  const NOW = at('2026-10-20T00:00:00.000Z');
  const CONSENT_1 = 'aa0e8400-e29b-41d4-a716-446655440001';
  const CONSENT_2 = 'aa0e8400-e29b-41d4-a716-446655440002';
  const consent = (overrides: Record<string, unknown>) => ({
    id: CONSENT_1,
    email: 'hanako@example.com',
    confirmExpiresAt: at('2026-10-11T00:00:00.000Z'),
    confirmedAt: null,
    withdrawnAt: null,
    createdAt: at('2026-10-10T00:00:00.000Z'),
    ...overrides,
  });
  const send = (overrides: Record<string, unknown>) => ({
    id: 'bb0e8400-e29b-41d4-a716-446655440001',
    consentId: CONSENT_1,
    email: 'hanako@example.com',
    status: 'sent',
    errorCode: null,
    createdAt: at('2026-10-10T00:05:00.000Z'),
    sentAt: at('2026-10-10T00:05:01.000Z'),
    ...overrides,
  });
  const emailKinds = [
    'result_email_requested',
    'result_email_sent',
    'email_unsubscribed',
  ] as const;
  const listEmail = () =>
    callerAs('member').leadActivity.list({
      organizationId: ORG_ID,
      leadId: LEAD_ID,
      limit: 50,
      types: [...emailKinds],
    });

  it('shows each state of a request: confirmed, declined, expired and waiting', async () => {
    queue({
      submissions: [],
      consents: [
        consent({ id: 'c-confirmed', confirmedAt: at('2026-10-10T00:04:00.000Z') }),
        consent({ id: 'c-declined', withdrawnAt: at('2026-10-10T01:00:00.000Z') }),
        consent({ id: 'c-expired' }),
        consent({ id: 'c-waiting', confirmExpiresAt: at('2026-10-21T00:00:00.000Z') }),
      ],
    });
    // The fixed clock of the expiry is the service's input, not the router's
    const { listLeadActivities } = await import('@/lib/features/lead-activity/service');
    // biome-ignore lint/suspicious/noExplicitAny: fake database
    const page = await listLeadActivities(fakeDb as any, {
      organizationId: ORG_ID,
      leadId: LEAD_ID,
      limit: 50,
      types: [...emailKinds],
      now: NOW,
    });
    const byId = (id: string) => page.items.find((e) => e.id === `email-request:${id}`);
    expect(byId('c-confirmed')).toMatchObject({
      kind: 'result_email_requested',
      actor: null,
      request: { state: 'confirmed', at: at('2026-10-10T00:04:00.000Z') },
    });
    expect(byId('c-declined')).toMatchObject({
      request: { state: 'declined', notRequested: false },
    });
    expect(byId('c-expired')).toMatchObject({
      request: { state: 'expired', at: at('2026-10-11T00:00:00.000Z') },
    });
    expect(byId('c-waiting')).toMatchObject({ request: { state: 'waiting', at: null } });
  });

  it('marks a declined request as "not requested" when the address was suppressed for that', async () => {
    queue({
      submissions: [],
      consents: [consent({ withdrawnAt: at('2026-10-10T01:00:00.000Z') })],
      suppressions: [
        {
          id: 's1',
          email: 'hanako@example.com',
          reason: 'not_requested',
          source: 'confirm_page',
          createdBy: null,
          createdAt: at('2026-10-10T01:00:00.000Z'),
        },
      ],
    });
    const { items } = await listEmail();
    expect(items.map((e) => e.kind)).toEqual(['email_unsubscribed', 'result_email_requested']);
    expect(items[0]).toEqual({
      id: 'email-suppression:s1',
      kind: 'email_unsubscribed',
      at: at('2026-10-10T01:00:00.000Z'),
      actor: null,
      reason: 'not_requested',
      source: 'confirm_page',
    });
    expect(items[1]).toMatchObject({ request: { state: 'declined', notRequested: true } });
  });

  it('counts a result mail once: a replay of a sent mail is not listed again', async () => {
    queue({
      submissions: [],
      sends: [
        send({
          id: 'replay',
          status: 'failed',
          errorCode: 'idempotent_replay',
          createdAt: at('2026-10-10T00:06:00.000Z'),
          sentAt: null,
        }),
        send({}),
        // Another request whose success was never recorded: the replay stands for it
        send({
          id: 'replay-only',
          consentId: CONSENT_2,
          status: 'failed',
          errorCode: 'idempotent_replay',
          createdAt: at('2026-10-12T00:00:00.000Z'),
          sentAt: null,
        }),
      ],
    });
    const { items } = await listEmail();
    expect(items).toEqual([
      {
        id: `email-sent:${CONSENT_2}`,
        kind: 'result_email_sent',
        at: at('2026-10-12T00:00:00.000Z'),
        actor: null,
        consentId: CONSENT_2,
      },
      {
        id: `email-sent:${CONSENT_1}`,
        kind: 'result_email_sent',
        at: at('2026-10-10T00:05:01.000Z'),
        actor: null,
        consentId: CONSENT_1,
      },
    ]);
  });

  it('names the staff member of a staff suppression and never exposes addresses or codes', async () => {
    queue({
      submissions: [],
      consents: [consent({ confirmedAt: at('2026-10-10T00:04:00.000Z') })],
      sends: [send({})],
      suppressions: [
        {
          id: 's2',
          email: 'hanako@example.com',
          reason: 'staff',
          source: 'staff',
          createdBy: STAFF_ID,
          createdAt: at('2026-10-15T00:00:00.000Z'),
        },
      ],
      users: [{ id: STAFF_ID, name: '営業 一郎', email: 'staff@example.com' }],
    });
    const { items } = await listEmail();
    expect(items[0]).toMatchObject({
      kind: 'email_unsubscribed',
      reason: 'staff',
      actor: { id: STAFF_ID, name: '営業 一郎' },
    });
    const text = JSON.stringify(items);
    expect(text).not.toContain('hanako@example.com');
    expect(text).not.toContain('idempotent_replay');
    expect(text).not.toMatch(/token|resend/i);
  });

  it('reads requests, sends and suppressions of this organization only', async () => {
    queue({
      submissions: [],
      consents: [consent({ email: 'old@example.com' })],
      sends: [send({ email: 'sent@example.com' })],
    });
    await listEmail();
    // lead, 5 sources, consents, sends, suppressions
    const [consentWhere, sendWhere, suppressionWhere] = dbState.wheres.slice(6, 9);
    const consentQuery = toQuery(consentWhere);
    expect(consentQuery.sql).toContain('"respondent_email_consents"."organization_id"');
    expect(consentQuery.params).toEqual([ORG_ID, LEAD_ID, 'ax_result_copy']);
    const sendQuery = toQuery(sendWhere);
    expect(sendQuery.sql).toContain('"respondent_email_sends"."organization_id"');
    expect(sendQuery.params).toEqual([ORG_ID, LEAD_ID, 'result', 'sent', 'failed', 'idempotent_replay']);
    // Matched by the lead's current address (normalised) and those of its requests and mails
    const suppressionQuery = toQuery(suppressionWhere);
    expect(suppressionQuery.sql).toContain('"email_suppressions"."organization_id"');
    expect(suppressionQuery.params).toEqual([
      ORG_ID,
      'hanako@example.com',
      'old@example.com',
      'sent@example.com',
    ]);
  });

  it('puts the new kinds under the email filter', async () => {
    const { LEAD_ACTIVITY_FILTERS } = await import('@/lib/features/lead-activity/types/schemas');
    expect(LEAD_ACTIVITY_FILTERS.email).toEqual([...emailKinds]);
  });
});

describe('leadActivity.submissionAnswers', () => {
  it('labels the answers from the diagnosis definition, scoped to the lead', async () => {
    dbState.results = [
      [{ id: LEAD_ID }],
      [
        submission({
          id: SUB_1,
          leadCreated: true,
          diagnosticVersion: 2,
          answers: { business_areas: ['sales', 'gone'], platform: 'as400', retired_q: 'x' },
          createdAt: T0,
        }),
      ],
    ];
    const result = await callerAs('parent_viewer').leadActivity.submissionAnswers({
      organizationId: ORG_ID,
      leadId: LEAD_ID,
      submissionId: SUB_1,
    });
    expect(result.verified).toBe(true);
    expect(result.answers.map((a) => a.questionId)).toEqual([
      'platform',
      'business_areas',
      'retired_q',
    ]);
    expect(result.answers[1]).toMatchObject({
      detail: true,
      values: [
        { value: 'sales', label: { ja: '販売・受発注' } },
        { value: 'gone', label: { ja: 'gone', en: 'gone' } },
      ],
    });
    const { params } = toQuery(dbState.wheres[1]);
    expect(params).toEqual([SUB_1, ORG_ID, LEAD_ID]);
  });

  it('reports a submission of another lead as not found', async () => {
    dbState.results = [[{ id: LEAD_ID }], []];
    await expect(
      callerAs('member').leadActivity.submissionAnswers({
        organizationId: ORG_ID,
        leadId: LEAD_ID,
        submissionId: SUB_1,
      })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
