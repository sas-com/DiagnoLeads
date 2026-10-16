/**
 * Diagnosis builder tables (#114) through the diagnoses router on a real PostgreSQL: immutable
 * versions (trigger), organization isolation, concurrent publishes, server-side checks before
 * publishing, optimistic concurrency of draft saves, permissions and audit rows.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55433/dl_test \
 *     bunx vitest --run test/unit/integration/diagnoses.db.test.ts
 */
import * as schema from '@/lib/db/schema';
import {
  auditLogs,
  diagnoses,
  diagnosisVersions,
  organizationMembers,
  organizations,
  users,
} from '@/lib/db/schema';
import { emptyDiagnosisDefinition } from '@/lib/features/diagnosis-builder/definition';
import { publishDiagnosis } from '@/lib/features/diagnosis-builder/service';
import { appRouter } from '@/server/routers/_app';
import { and, asc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { cloudReadiness } from '../../fixtures/diagnosis-builder';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('diagnoses (PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 6, onnotice: () => {} }) : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const pg = (client ? drizzle(client, { schema }) : null)!;
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const organizationIds: string[] = [];
  let orgA: string;
  let orgB: string;
  let userA: string;
  // biome-ignore lint/suspicious/noExplicitAny: tRPC caller
  let adminA: any;
  // biome-ignore lint/suspicious/noExplicitAny: tRPC caller
  let memberA: any;
  // biome-ignore lint/suspicious/noExplicitAny: tRPC caller
  let adminB: any;

  async function createOrganization(name: string) {
    const [org] = await pg
      .insert(organizations)
      .values({ name, slug: `diagnoses-${unique()}` })
      .returning();
    organizationIds.push(org.id);
    return org.id;
  }

  async function callerFor(organizationId: string, role: string) {
    const [user] = await pg
      .insert(users)
      .values({ email: `diagnoses-${unique()}@example.com`, name: 'テスト 太郎' })
      .returning();
    await pg.insert(organizationMembers).values({ organizationId, userId: user.id, role });
    const caller = appRouter.createCaller({
      db: pg,
      session: { session: { id: 's', userId: user.id }, user },
      user,
      // biome-ignore lint/suspicious/noExplicitAny: test context
    } as any);
    return { caller, userId: user.id };
  }

  /** A diagnosis of orgA whose draft is the fictional fixture (publishable) */
  async function createReadyDiagnosis() {
    const created = await adminA.diagnoses.create({
      organizationId: orgA,
      name: 'クラウド準備度（テスト）',
      slug: `cloud-${unique()}`,
    });
    return adminA.diagnoses.saveDraft({
      organizationId: orgA,
      id: created.id,
      definition: cloudReadiness(),
      expectedUpdatedAt: created.updatedAt,
    });
  }

  /** The code PostgreSQL raised (drizzle may wrap the driver error) */
  async function pgErrorOf(promise: Promise<unknown>) {
    try {
      await promise;
    } catch (error) {
      const e = error as { code?: string; message?: string; cause?: { code?: string } };
      return { code: e.code ?? e.cause?.code, message: String(e.message) };
    }
    return null;
  }

  beforeAll(async () => {
    orgA = await createOrganization('診断ビルダーテストA株式会社');
    orgB = await createOrganization('診断ビルダーテストB株式会社');
    const a = await callerFor(orgA, 'admin');
    adminA = a.caller;
    userA = a.userId;
    memberA = (await callerFor(orgA, 'member')).caller;
    adminB = (await callerFor(orgB, 'admin')).caller;
  });

  afterAll(async () => {
    for (const id of organizationIds) {
      await pg.delete(organizations).where(eq(organizations.id, id));
    }
    await client?.end();
  });

  it('creates, saves, publishes, pauses, resumes and archives, with audit rows', async () => {
    const draft = await createReadyDiagnosis();
    expect(draft.status).toBe('draft');

    const published = await adminA.diagnoses.publish({
      organizationId: orgA,
      id: draft.id,
      expectedUpdatedAt: draft.updatedAt,
    });
    expect(published.version.version).toBe(1);
    expect(published.diagnosis).toMatchObject({
      status: 'published',
      currentVersion: { id: published.version.id, version: 1 },
    });

    const [version] = await pg
      .select()
      .from(diagnosisVersions)
      .where(eq(diagnosisVersions.id, published.version.id));
    expect(version).toMatchObject({ organizationId: orgA, diagnosisId: draft.id, version: 1 });
    expect(version.definition).toEqual(cloudReadiness());
    expect(version.definitionHash).toMatch(/^[0-9a-f]{64}$/);

    // Editing the draft after publishing leaves the published copy as it was
    const edited = cloudReadiness();
    edited.title = '下書きだけ変更';
    await adminA.diagnoses.saveDraft({
      organizationId: orgA,
      id: draft.id,
      definition: edited,
      expectedUpdatedAt: published.diagnosis.updatedAt,
    });
    const [still] = await pg
      .select({ definition: diagnosisVersions.definition })
      .from(diagnosisVersions)
      .where(eq(diagnosisVersions.id, published.version.id));
    expect(still.definition.title).toBe(cloudReadiness().title);

    await adminA.diagnoses.pause({ organizationId: orgA, id: draft.id });
    await adminA.diagnoses.resume({ organizationId: orgA, id: draft.id });
    const archived = await adminA.diagnoses.archive({ organizationId: orgA, id: draft.id });
    expect(archived.status).toBe('archived');

    const logs = await pg
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.resource, 'diagnosis'), eq(auditLogs.resourceId, draft.id)))
      .orderBy(asc(auditLogs.createdAt));
    expect(logs.map((l) => [l.action, l.metadata?.event ?? null])).toEqual([
      ['create', null],
      ['update', 'publish'],
      ['update', 'pause'],
      ['update', 'resume'],
      ['update', 'archive'],
    ]);
    expect(logs.every((l) => l.organizationId === orgA && l.userId === userA)).toBe(true);
    expect(logs[1].changes).toEqual({
      before: { status: 'draft', version: null },
      after: { status: 'published', version: 1 },
    });
    expect(logs[1].metadata).toMatchObject({
      versionId: published.version.id,
      changeSummary: { previousVersion: null },
    });
  });

  describe('immutable versions (trigger)', () => {
    let versionId: string;
    let diagnosisId: string;

    beforeAll(async () => {
      const draft = await createReadyDiagnosis();
      diagnosisId = draft.id;
      const published = await adminA.diagnoses.publish({
        organizationId: orgA,
        id: draft.id,
        expectedUpdatedAt: draft.updatedAt,
      });
      versionId = published.version.id;
    });

    it('rejects UPDATE of a version row', async () => {
      const error = await pgErrorOf(
        pg
          .update(diagnosisVersions)
          .set({ definitionHash: 'tampered' })
          .where(eq(diagnosisVersions.id, versionId))
      );
      expect(error).toMatchObject({ code: '23001' });
      const [row] = await pg
        .select({ hash: diagnosisVersions.definitionHash })
        .from(diagnosisVersions)
        .where(eq(diagnosisVersions.id, versionId));
      expect(row.hash).not.toBe('tampered');
    });

    it('rejects DELETE of a version row', async () => {
      const error = await pgErrorOf(
        pg.delete(diagnosisVersions).where(eq(diagnosisVersions.id, versionId))
      );
      expect(error).toMatchObject({ code: '23001' });
    });

    it('rejects deleting a diagnosis that has versions, in the router and in the database', async () => {
      await expect(
        adminA.diagnoses.delete({ organizationId: orgA, id: diagnosisId })
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      const error = await pgErrorOf(pg.delete(diagnoses).where(eq(diagnoses.id, diagnosisId)));
      expect(error).toMatchObject({ code: '23001' });
      const rows = await pg
        .select({ id: diagnosisVersions.id })
        .from(diagnosisVersions)
        .where(eq(diagnosisVersions.diagnosisId, diagnosisId));
      expect(rows).toHaveLength(1);
    });

    it('still lets the whole organization be deleted', async () => {
      const orgC = await createOrganization('診断ビルダーテストC株式会社');
      const { caller } = await callerFor(orgC, 'owner');
      const created = await caller.diagnoses.create({
        organizationId: orgC,
        name: '削除テスト',
        slug: 'to-remove',
      });
      const draft = await caller.diagnoses.saveDraft({
        organizationId: orgC,
        id: created.id,
        definition: cloudReadiness(),
        expectedUpdatedAt: created.updatedAt,
      });
      await caller.diagnoses.publish({
        organizationId: orgC,
        id: draft.id,
        expectedUpdatedAt: draft.updatedAt,
      });

      await pg.delete(organizations).where(eq(organizations.id, orgC));
      const left = await pg
        .select({ id: diagnosisVersions.id })
        .from(diagnosisVersions)
        .where(eq(diagnosisVersions.organizationId, orgC));
      expect(left).toEqual([]);
    });
  });

  it('reports a diagnosis of another organization as not found', async () => {
    const draft = await createReadyDiagnosis();
    const asB = { organizationId: orgB, id: draft.id };
    await expect(adminB.diagnoses.get(asB)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(adminB.diagnoses.validate(asB)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      adminB.diagnoses.saveDraft({
        ...asB,
        definition: cloudReadiness(),
        expectedUpdatedAt: draft.updatedAt,
      })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      adminB.diagnoses.publish({ ...asB, expectedUpdatedAt: draft.updatedAt })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    for (const action of ['pause', 'resume', 'archive', 'delete'] as const) {
      await expect(adminB.diagnoses[action](asB)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    }
    const listB = await adminB.diagnoses.list({ organizationId: orgB });
    expect(listB.items.map((d: { id: string }) => d.id)).not.toContain(draft.id);
    // Unchanged
    const [row] = await pg.select().from(diagnoses).where(eq(diagnoses.id, draft.id));
    expect(row).toMatchObject({ status: 'draft', updatedAt: draft.updatedAt });
  });

  it('gives concurrent publishes distinct version numbers', async () => {
    const draft = await createReadyDiagnosis();
    const variants = Array.from({ length: 5 }, (_, i) => {
      const def = cloudReadiness();
      def.title = `同時公開 ${i}`;
      return def;
    });
    // Each publish takes whatever the draft holds when it gets the row lock. Saves and publishes
    // run in parallel (no expectedUpdatedAt), so several publishes race for the next number.
    await pg
      .update(diagnoses)
      .set({ draftDefinition: variants[0] })
      .where(eq(diagnoses.id, draft.id));
    const results = await Promise.allSettled(
      variants.map(async (def, i) => {
        if (i > 0) {
          await pg.update(diagnoses).set({ draftDefinition: def }).where(eq(diagnoses.id, draft.id));
        }
        return publishDiagnosis(pg, { organizationId: orgA, id: draft.id, userId: userA });
      })
    );
    const rows = await pg
      .select({ version: diagnosisVersions.version })
      .from(diagnosisVersions)
      .where(eq(diagnosisVersions.diagnosisId, draft.id))
      .orderBy(asc(diagnosisVersions.version));
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    // Some publishes may find nothing new (same draft as the previous version); none may fail
    // any other way, and the numbers are 1..n without gaps or duplicates
    for (const r of results) {
      if (r.status === 'rejected') {
        expect(r.reason).toMatchObject({ code: 'BAD_REQUEST' });
        expect(String(r.reason.message)).toContain('Nothing changed');
      }
    }
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    expect(rows.map((r) => r.version)).toEqual(
      Array.from({ length: fulfilled.length }, (_, i) => i + 1)
    );

    const [row] = await pg.select().from(diagnoses).where(eq(diagnoses.id, draft.id));
    const [latest] = await pg
      .select({ id: diagnosisVersions.id })
      .from(diagnosisVersions)
      .where(
        and(
          eq(diagnosisVersions.diagnosisId, draft.id),
          eq(diagnosisVersions.version, fulfilled.length)
        )
      );
    expect(row.currentVersionId).toBe(latest.id);
  });

  it('refuses to publish a draft with errors', async () => {
    const created = await adminA.diagnoses.create({
      organizationId: orgA,
      name: '空の診断',
      slug: `empty-${unique()}`,
    });
    expect(created.draftDefinition).toEqual(emptyDiagnosisDefinition('空の診断'));
    const check = await adminA.diagnoses.validate({ organizationId: orgA, id: created.id });
    expect(check.errors.length).toBeGreaterThan(0);

    await expect(
      adminA.diagnoses.publish({
        organizationId: orgA,
        id: created.id,
        expectedUpdatedAt: created.updatedAt,
      })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    const rows = await pg
      .select()
      .from(diagnosisVersions)
      .where(eq(diagnosisVersions.diagnosisId, created.id));
    expect(rows).toEqual([]);
    const [row] = await pg.select().from(diagnoses).where(eq(diagnoses.id, created.id));
    expect(row).toMatchObject({ status: 'draft', currentVersionId: null });
  });

  it('returns CONFLICT for a stale expectedUpdatedAt (save and publish)', async () => {
    const draft = await createReadyDiagnosis();
    const stale = draft.updatedAt;
    const second = cloudReadiness();
    second.title = '別の人が保存';
    const saved = await adminA.diagnoses.saveDraft({
      organizationId: orgA,
      id: draft.id,
      definition: second,
      expectedUpdatedAt: stale,
    });
    expect(saved.updatedAt.getTime()).toBeGreaterThan(stale.getTime());

    await expect(
      adminA.diagnoses.saveDraft({
        organizationId: orgA,
        id: draft.id,
        definition: cloudReadiness(),
        expectedUpdatedAt: stale,
      })
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(
      adminA.diagnoses.publish({ organizationId: orgA, id: draft.id, expectedUpdatedAt: stale })
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    const [row] = await pg.select().from(diagnoses).where(eq(diagnoses.id, draft.id));
    expect(row.draftDefinition.title).toBe('別の人が保存');
    expect(row.currentVersionId).toBeNull();
  });

  it('lets a member read but not edit or publish', async () => {
    const draft = await createReadyDiagnosis();
    const id = { organizationId: orgA, id: draft.id };
    const list = await memberA.diagnoses.list({ organizationId: orgA });
    expect(list).toMatchObject({ canEdit: false, canPublish: false });
    await expect(memberA.diagnoses.get(id)).resolves.toMatchObject({ id: draft.id });

    await expect(
      memberA.diagnoses.create({ organizationId: orgA, name: 'x', slug: `m-${unique()}` })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      memberA.diagnoses.saveDraft({
        ...id,
        definition: cloudReadiness(),
        expectedUpdatedAt: draft.updatedAt,
      })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      memberA.diagnoses.publish({ ...id, expectedUpdatedAt: draft.updatedAt })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(memberA.diagnoses.delete(id)).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const [row] = await pg.select().from(diagnoses).where(eq(diagnoses.id, draft.id));
    expect(row).toMatchObject({ status: 'draft', updatedAt: draft.updatedAt });
  });

  it('keeps slugs unique per organization only, and deletes a never-published draft', async () => {
    const slug = `shared-${unique()}`;
    const a = await adminA.diagnoses.create({ organizationId: orgA, name: 'A', slug });
    await expect(
      adminA.diagnoses.create({ organizationId: orgA, name: 'A2', slug })
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(
      adminB.diagnoses.create({ organizationId: orgB, name: 'B', slug })
    ).resolves.toMatchObject({ slug });

    await expect(adminA.diagnoses.delete({ organizationId: orgA, id: a.id })).resolves.toEqual({
      id: a.id,
    });
    const left = await pg.select().from(diagnoses).where(eq(diagnoses.id, a.id));
    expect(left).toEqual([]);
    const [log] = await pg
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.resource, 'diagnosis'),
          eq(auditLogs.resourceId, a.id),
          eq(auditLogs.action, 'delete')
        )
      );
    expect(log.changes).toEqual({ before: { name: 'A', slug } });
  });

  it('accepts the new submission columns with their defaults', async () => {
    const [row] = await pg
      .insert(schema.diagnosticSubmissions)
      .values({
        organizationId: orgA,
        diagnosticKey: 'ax-migration',
        diagnosticVersion: 1,
        answers: {},
        result: {},
      })
      .returning();
    expect(row).toMatchObject({ diagnosisVersionId: null, isTest: false, consent: null });
  });
});
