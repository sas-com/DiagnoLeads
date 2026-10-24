/**
 * Recipients of a consultation request on a builder diagnosis (#481) against a real PostgreSQL:
 * the request reaches only people of the diagnosis's organization. Its intake members (窓口)
 * in-app and by email when it has any; otherwise every member in-app, and by email the sales
 * addresses (AX_DIAGNOSIS_SALES_EMAIL) only for the operator's organization (the one that
 * receives the AX diagnosis). Another organization without intake gets no email at all.
 * The request is made through the submission service, so the organization is the diagnosis's
 * own, as in the consultation route. All names are made up; sendEmail is a fake.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/dl_test \
 *     bunx vitest --run test/unit/integration/diagnosis-consultation-recipients.db.test.ts
 */
import type { Database } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';
import {
  diagnoses,
  diagnosisVersions,
  notifications,
  organizationMembers,
  organizations,
  users,
} from '@/lib/db/schema';
import {
  type DiagnosisNotification,
  notifyDiagnosisSubmission,
} from '@/lib/features/diagnosis-builder/notify';
import { resolveSubmittedVersion } from '@/lib/features/diagnosis-builder/public-diagnosis';
import {
  findBuilderSubmission,
  mqlReasonTexts,
  requestBuilderConsultation,
  resultTypeName,
  submitBuilderDiagnosis,
} from '@/lib/features/diagnosis-builder/submission-service';
import { hashDefinition } from '@/lib/features/diagnosis-builder/versions';
import { env } from '@/lib/env';
import { setIntakeUserIds } from '@/lib/features/leads/assignment';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cloudReadiness } from '../../fixtures/diagnosis-builder';

// The notification code runs on this database with a fake sendEmail. The operator's
// organization and the sales addresses are set per test on the environment of test/setup.ts.
const deps = vi.hoisted(() => ({
  db: null as unknown,
  sendEmail: null as unknown as (o: { to: string[] }) => Promise<{ id: string }>,
}));
vi.mock('@/lib/db/client', () => ({
  get db() {
    return deps.db;
  },
}));
vi.mock('@/lib/features/email', () => ({
  sendEmail: (o: { to: string[] }) => deps.sendEmail(o),
  isEmailConfigured: () => true,
}));
vi.mock('@/lib/features/webhooks/services/webhook-service', () => ({
  triggerWebhooks: vi.fn().mockResolvedValue({ triggered: 0, failed: 0 }),
}));
vi.mock('@/lib/features/webhooks/services/lead-events', () => ({
  sendLeadCreatedById: vi.fn().mockResolvedValue(undefined),
}));

const testEnv = env as { AX_DIAGNOSIS_ORGANIZATION_ID?: string; AX_DIAGNOSIS_SALES_EMAIL?: string };

const url = process.env.TEST_DATABASE_URL;
const SALES = 'sales@operator.example.jp';

describe.skipIf(!url)('builder consultation recipients (PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 4, onnotice: () => {} }) : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const pg = (client ? drizzle(client, { schema }) : null)! as unknown as Database;
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date('2026-10-16T01:00:00Z');
  const HOUR = 60 * 60 * 1000;
  const organizationIds: string[] = [];
  const userIds: string[] = [];

  type Member = { id: string; email: string };
  let operator: string;
  let other: string;
  let withIntake: string;
  let operatorMember: Member;
  let otherMembers: Member[];
  let intakeMember: Member;
  let nonIntakeMember: Member;

  const sendEmail = vi.fn<(o: { to: string[] }) => Promise<{ id: string }>>();

  async function createOrganization(name: string) {
    const [org] = await pg
      .insert(organizations)
      .values({ name, slug: `consult-to-${unique()}` })
      .returning({ id: organizations.id });
    organizationIds.push(org.id);
    return org.id;
  }

  async function createMember(organizationId: string): Promise<Member> {
    const [user] = await pg
      .insert(users)
      .values({ email: `consult-to-${unique()}@example.com`, name: '架空 社員' })
      .returning({ id: users.id, email: users.email });
    userIds.push(user.id);
    await pg.insert(organizationMembers).values({ organizationId, userId: user.id, role: 'member' });
    return user;
  }

  /** Publish a diagnosis of the organization, answer it and request a consultation */
  async function consultationOn(organizationId: string): Promise<DiagnosisNotification> {
    const definition = cloudReadiness();
    const slug = `consult-${Math.random().toString(36).slice(2, 10)}`;
    const [diagnosis] = await pg
      .insert(diagnoses)
      .values({
        organizationId,
        slug,
        name: '架空のクラウド準備度',
        status: 'published',
        draftDefinition: definition,
      })
      .returning({ id: diagnoses.id });
    const [version] = await pg
      .insert(diagnosisVersions)
      .values({
        diagnosisId: diagnosis.id,
        organizationId,
        version: 1,
        definition,
        definitionHash: hashDefinition(definition),
        changeSummary: {
          previousVersion: null,
          questionsAdded: [],
          questionsRemoved: [],
          questionsChanged: [],
          partsChanged: ['title'],
        },
        publishedAt: new Date(now.getTime() - HOUR),
      })
      .returning({ id: diagnosisVersions.id });
    await pg
      .update(diagnoses)
      .set({ currentVersionId: version.id })
      .where(eq(diagnoses.id, diagnosis.id));

    const resolved = await resolveSubmittedVersion(pg, slug, version.id, now);
    if (!resolved.ok) throw new Error(`version not accepted: ${resolved.reason}`);
    const submitted = await submitBuilderDiagnosis(
      pg,
      resolved.diagnosis,
      resolved.version,
      {
        versionId: version.id,
        answers: { hosting: 'onprem', team_size: 150, migration_plan: 'this_year', confidence: 4 },
        contact: { company: '架空商事', name: '試験 太郎', email: `taro-${unique()}@example.co.jp` },
        privacyConsent: true,
        consentVersion: '2026-10-01',
        consultationRequested: false,
        tracking: {},
        locale: 'ja',
      },
      now
    );
    if (!submitted.ok) throw new Error('submission failed');
    const requestedAt = new Date(now.getTime() + 60_000);
    const outcome = await requestBuilderConsultation(
      pg,
      diagnosis.id,
      submitted.submissionId,
      requestedAt
    );
    if (!outcome.ok || !outcome.leadId) throw new Error('consultation not recorded');
    const submission = await findBuilderSubmission(pg, submitted.submissionId);
    if (!submission) throw new Error('submission not found');

    // The same notification the consultation route sends
    return {
      organizationId: outcome.organizationId,
      diagnosisId: diagnosis.id,
      diagnosisTitle: submission.definition.title,
      leadId: outcome.leadId,
      submissionId: submission.id,
      company: '架空商事',
      name: '試験 太郎',
      email: 'taro@example.co.jp',
      resultTypeName: resultTypeName(submission.definition, submission.evaluation),
      leadScore: submission.evaluation.leadScore.points,
      mqlLevel: submission.evaluation.mql.level ?? 'fit',
      mqlQualified: submission.evaluation.mql.qualified,
      mqlReasons: mqlReasonTexts(submission.definition, submission.evaluation),
      consultationRequested: true,
      leadCreated: false,
      identityUnverified: !outcome.leadCreated,
      requestedAt,
    };
  }

  /** In-app consultation notifications of the lead: who got one, in which organization */
  async function inAppFor(leadId: string) {
    const rows = await pg
      .select({ userId: notifications.userId, organizationId: notifications.organizationId })
      .from(notifications)
      .where(
        and(
          eq(notifications.type, 'consultation_requested'),
          sql`${notifications.data}->>'leadId' = ${leadId}`
        )
      );
    return rows.sort((a, b) => a.userId.localeCompare(b.userId));
  }

  const byUser = (organizationId: string, members: Member[]) =>
    members
      .map((member) => ({ userId: member.id, organizationId }))
      .sort((a, b) => a.userId.localeCompare(b.userId));

  const mailedTo = () => sendEmail.mock.calls.flatMap(([mail]) => mail.to);

  beforeAll(async () => {
    deps.db = pg;
    deps.sendEmail = (o) => sendEmail(o);
    operator = await createOrganization('運営テスト株式会社');
    other = await createOrganization('他社テスト株式会社');
    withIntake = await createOrganization('窓口テスト株式会社');
    operatorMember = await createMember(operator);
    otherMembers = [await createMember(other), await createMember(other)];
    intakeMember = await createMember(withIntake);
    nonIntakeMember = await createMember(withIntake);
    // A stale or forged intake id of a user of another organization is never told
    await setIntakeUserIds(pg, withIntake, [intakeMember.id, operatorMember.id]);
  });

  beforeEach(() => {
    sendEmail.mockReset();
    sendEmail.mockResolvedValue({ id: 'mail-1' });
    testEnv.AX_DIAGNOSIS_ORGANIZATION_ID = operator;
    testEnv.AX_DIAGNOSIS_SALES_EMAIL = SALES;
  });

  afterAll(async () => {
    delete testEnv.AX_DIAGNOSIS_ORGANIZATION_ID;
    delete testEnv.AX_DIAGNOSIS_SALES_EMAIL;
    if (!client) return;
    if (organizationIds.length > 0) {
      await pg.delete(organizations).where(inArray(organizations.id, organizationIds));
    }
    if (userIds.length > 0) await pg.delete(users).where(inArray(users.id, userIds));
    await client.end();
  });

  it("mails the sales addresses for the operator's diagnosis without intake", async () => {
    const n = await consultationOn(operator);
    expect(n.organizationId).toBe(operator);
    await notifyDiagnosisSubmission(n);
    expect(mailedTo()).toEqual([SALES]);
    expect(await inAppFor(n.leadId)).toEqual(byUser(operator, [operatorMember]));
  });

  it('never mails the sales addresses for another organization without intake', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const n = await consultationOn(other);
      expect(n.organizationId).toBe(other);
      await notifyDiagnosisSubmission(n);
      expect(sendEmail).not.toHaveBeenCalled();
      // Every member of that organization in-app, and nobody of the operator
      expect(await inAppFor(n.leadId)).toEqual(byUser(other, otherMembers));
    } finally {
      warn.mockRestore();
    }
  });

  it("tells only the organization's intake members, in-app and by email", async () => {
    const n = await consultationOn(withIntake);
    await notifyDiagnosisSubmission(n);
    expect(mailedTo()).toEqual([intakeMember.email]);
    expect(mailedTo()).not.toContain(SALES);
    expect(mailedTo()).not.toContain(operatorMember.email);
    expect(await inAppFor(n.leadId)).toEqual(byUser(withIntake, [intakeMember]));
    expect((await inAppFor(n.leadId)).map((row) => row.userId)).not.toContain(nonIntakeMember.id);
  });

  it("mails the intake members instead of the sales addresses when the operator's organization has them", async () => {
    // The same rule as the AX diagnosis: the intake members take the place of the sales addresses
    testEnv.AX_DIAGNOSIS_ORGANIZATION_ID = withIntake;
    const n = await consultationOn(withIntake);
    await notifyDiagnosisSubmission(n);
    expect(mailedTo()).toEqual([intakeMember.email]);
    expect(mailedTo()).not.toContain(SALES);
    expect(await inAppFor(n.leadId)).toEqual(byUser(withIntake, [intakeMember]));
  });

  it('mails no organization the sales addresses when no operator is configured', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      testEnv.AX_DIAGNOSIS_ORGANIZATION_ID = undefined;
      const n = await consultationOn(operator);
      await notifyDiagnosisSubmission(n);
      expect(sendEmail).not.toHaveBeenCalled();
      expect(await inAppFor(n.leadId)).toEqual(byUser(operator, [operatorMember]));
    } finally {
      warn.mockRestore();
    }
  });
});
