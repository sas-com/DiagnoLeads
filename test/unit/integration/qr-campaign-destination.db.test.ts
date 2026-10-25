/**
 * Where a scan of a QR campaign goes, on PostgreSQL (#692, #695): the settings page's list
 * (distribution.listCampaigns) shows for each campaign what the /q/ entry does with it, and the
 * list's one query for the diagnoses (servedCampaignDiagnoses, which the distribution feature
 * writes itself because it does not import the builder) agrees with findPublicDiagnosis, the
 * rule of /d/<slug>, in every state: published, paused, archived, a draft, a slug two
 * organizations publish (and one the other organization has stopped), a current version of
 * another organization, and a diagnosis of another organization. The list reads the campaigns
 * and diagnoses of the caller's organization only. The id of the AX organization is set in upper
 * case in the environment (#698).
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55433/dl_test \
 *     bunx vitest --run test/unit/integration/qr-campaign-destination.db.test.ts
 */
import { GET } from '@/app/q/[code]/route';
import type { Database } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';
import {
  diagnoses,
  diagnosisVersions,
  diagnosticTemplates,
  organizationMembers,
  organizations,
  qrCampaigns,
  users,
} from '@/lib/db/schema';
import { findPublicDiagnosis } from '@/lib/features/diagnosis-builder/public-diagnosis';
import { hashDefinition } from '@/lib/features/diagnosis-builder/versions';
import {
  qrEntryRedirectPath,
  servedCampaignDiagnoses,
} from '@/lib/features/distribution/short-code-entry';
import type { QrCampaignDestination } from '@/lib/features/distribution/types';
import { appRouter } from '@/server/routers/_app';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { NextRequest } from 'next/server';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { cloudReadiness } from '../../fixtures/diagnosis-builder';

// The router (global client) and the entry (lib/db/client) both run on the test database
const deps = vi.hoisted(() => ({
  db: null as unknown,
  env: {
    NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
    AX_DIAGNOSIS_ORGANIZATION_ID: undefined as string | undefined,
  },
}));
vi.mock('@/lib/db', () => ({
  get db() {
    return deps.db;
  },
}));
vi.mock('@/lib/db/client', () => ({
  get db() {
    return deps.db;
  },
}));
vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/env', () => ({ env: deps.env }));
vi.mock('@/lib/ops/alert', () => ({ reportRejectedRequest: vi.fn(), reportServerError: vi.fn() }));
// The scan recording after the response is not the point here
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: () => {},
}));

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('where a scan of a QR campaign goes (PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 2, onnotice: () => {} }) : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const pg = (client ? drizzle(client, { schema }) : null)! as unknown as Database;
  deps.db = pg;
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const randomPart = (length: number) => {
    const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
    return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  };
  const organizationIds: string[] = [];
  const userIds: string[] = [];
  const templates = new Map<string, string>();
  let orgAx: string;
  let orgB: string;
  let orgC: string;

  async function createOrganization(name: string) {
    const [org] = await pg
      .insert(organizations)
      .values({ name, slug: `qr-dest-${unique()}` })
      .returning({ id: organizations.id });
    organizationIds.push(org.id);
    const [template] = await pg
      .insert(diagnosticTemplates)
      .values({ organizationId: org.id, name: 'Template', slug: `t-${unique()}`, title: 'Template' })
      .returning({ id: diagnosticTemplates.id });
    templates.set(org.id, template.id);
    return org.id;
  }

  async function callerFor(organizationId: string) {
    const [user] = await pg
      .insert(users)
      .values({ email: `qr-dest-${unique()}@example.com`, name: 'QR' })
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

  /**
   * A diagnosis with a published version, then left in `status`. `versionOf` makes the current
   * version one of another organization (rows the builder never writes, read the way
   * findPublicDiagnosis reads them)
   */
  async function createDiagnosis(
    organizationId: string,
    slug: string,
    status: 'published' | 'paused' | 'archived' = 'published',
    versionOf: string = organizationId
  ) {
    const definition = cloudReadiness();
    const [row] = await pg
      .insert(diagnoses)
      .values({ organizationId, slug, name: '架空の診断', status, draftDefinition: definition })
      .returning({ id: diagnoses.id });
    const [version] = await pg
      .insert(diagnosisVersions)
      .values({
        diagnosisId: row.id,
        organizationId: versionOf,
        version: 1,
        definition,
        definitionHash: hashDefinition(definition),
        changeSummary: {
          previousVersion: null,
          questionsAdded: [],
          questionsRemoved: [],
          questionsChanged: [],
          partsChanged: [],
        },
        publishedAt: new Date('2026-10-01T00:00:00Z'),
      })
      .returning({ id: diagnosisVersions.id });
    await pg.update(diagnoses).set({ currentVersionId: version.id }).where(eq(diagnoses.id, row.id));
    return row.id;
  }

  async function createDraft(organizationId: string, slug: string) {
    const [row] = await pg
      .insert(diagnoses)
      .values({ organizationId, slug, name: '架空の下書き', draftDefinition: cloudReadiness() })
      .returning({ id: diagnoses.id });
    return row.id;
  }

  async function createCampaign(
    organizationId: string,
    values: Partial<typeof qrCampaigns.$inferInsert> = {}
  ) {
    const shortCode = `Qd${randomPart(8)}`;
    await pg.insert(qrCampaigns).values({
      organizationId,
      // biome-ignore lint/style/noNonNullAssertion: created with the organization
      diagnosticTemplateId: templates.get(organizationId)!,
      name: `Campaign ${shortCode}`,
      shortCode,
      trackingUrl: `https://example.com/q/${shortCode}`,
      ...values,
    });
    return shortCode;
  }

  async function scan(code: string) {
    return GET(new NextRequest(`https://app.example/q/${code}`), {
      params: Promise.resolve({ code }),
    });
  }

  /**
   * The diagnoses B's campaigns name, with whether the entry sends a scan of such a campaign
   * there: a diagnosis of B that /d/<slug> serves
   */
  const named = new Map<
    string,
    { id: string; slug: string; organizationId: string; served: boolean }
  >();

  beforeAll(async () => {
    orgAx = await createOrganization('QR行き先AX');
    orgB = await createOrganization('QR行き先B');
    orgC = await createOrganization('QR行き先C');
    deps.env.AX_DIAGNOSIS_ORGANIZATION_ID = orgAx.toUpperCase();

    const slug = (name: string) => `qr-dest-${name}-${randomPart(6)}`;
    const add = async (
      name: string,
      id: Promise<string>,
      path: string,
      served: boolean,
      organizationId = orgB
    ) => {
      named.set(name, { id: await id, slug: path, organizationId, served });
    };
    const published = slug('published');
    await add('published', createDiagnosis(orgB, published), published, true);
    const paused = slug('paused');
    await add('paused', createDiagnosis(orgB, paused, 'paused'), paused, false);
    const archived = slug('archived');
    await add('archived', createDiagnosis(orgB, archived, 'archived'), archived, false);
    const draft = slug('draft');
    await add('draft', createDraft(orgB, draft), draft, false);
    // C publishes the same slug: /d/<slug> serves neither
    const clash = slug('clash');
    await createDiagnosis(orgC, clash);
    await add('clash', createDiagnosis(orgB, clash), clash, false);
    // C has stopped the same slug: B's is the only one published
    const clashStopped = slug('clash-stopped');
    await createDiagnosis(orgC, clashStopped, 'paused');
    await add('clash-stopped', createDiagnosis(orgB, clashStopped), clashStopped, true);
    // B has stopped it and C publishes it: /d/<slug> serves C's
    const othersOnly = slug('others-only');
    await createDiagnosis(orgC, othersOnly);
    await add('others-only', createDiagnosis(orgB, othersOnly, 'paused'), othersOnly, false);
    const foreignVersion = slug('foreign-version');
    await add(
      'foreign-version',
      createDiagnosis(orgB, foreignVersion, 'published', orgC),
      foreignVersion,
      false
    );
    // A diagnosis of C that a campaign of B names
    const ofC = slug('of-c');
    await add('of-c', createDiagnosis(orgC, ofC), ofC, false, orgC);
  });

  afterAll(async () => {
    if (organizationIds.length > 0) {
      await pg.delete(organizations).where(inArray(organizations.id, organizationIds));
    }
    if (userIds.length > 0) await pg.delete(users).where(inArray(users.id, userIds));
    await client?.end();
  });

  it("serves B's diagnoses exactly where /d/<slug> serves them (findPublicDiagnosis)", async () => {
    const served = await servedCampaignDiagnoses(
      pg,
      orgB,
      [...named.values()].map((diagnosis) => diagnosis.id)
    );
    for (const [name, diagnosis] of named) {
      // The entry looks the slug up only for a diagnosis of the campaign's own organization
      const publicDiagnosis = await findPublicDiagnosis(pg, diagnosis.slug);
      const servesIt = diagnosis.organizationId === orgB && publicDiagnosis?.id === diagnosis.id;
      expect(servesIt, `${name}: /d/<slug>`).toBe(diagnosis.served);
      expect(served.has(diagnosis.id), `${name}: the list`).toBe(servesIt);
    }
    expect(served.get(named.get('published')?.id ?? '')).toEqual({
      id: named.get('published')?.id,
      slug: named.get('published')?.slug,
    });
  });

  it('reads only the diagnoses of the organization asked for', async () => {
    const ofC = named.get('of-c')?.id as string;
    expect((await servedCampaignDiagnoses(pg, orgB, [ofC])).size).toBe(0);
    expect((await servedCampaignDiagnoses(pg, orgC, [ofC])).has(ofC)).toBe(true);
  });

  it('lists for each campaign what the /q/ entry does with it', async () => {
    const past = new Date(Date.now() - 60_000);
    const later = new Date(Date.now() + 60 * 60_000);
    // What each campaign of B is expected to show; every case is also scanned
    const expected = new Map<string, QrCampaignDestination>();
    const expect_ = async (
      values: Partial<typeof qrCampaigns.$inferInsert>,
      destination: QrCampaignDestination
    ) => expected.set(await createCampaign(orgB, values), destination);
    for (const [name, diagnosis] of named) {
      await expect_(
        { diagnosisId: diagnosis.id },
        diagnosis.served
          ? { kind: 'diagnosis', slug: diagnosis.slug }
          : { kind: 'none', reasons: ['diagnosis_not_published'] }
      );
      if (name === 'published') {
        await expect_(
          { diagnosisId: diagnosis.id, isActive: false },
          { kind: 'none', reasons: ['paused'] }
        );
        await expect_(
          { diagnosisId: diagnosis.id, expiresAt: past },
          { kind: 'none', reasons: ['expired'] }
        );
        await expect_({ diagnosisId: diagnosis.id, expiresAt: later }, {
          kind: 'diagnosis',
          slug: diagnosis.slug,
        });
      }
    }
    await expect_({}, { kind: 'none', reasons: ['not_ax_organization'] });
    await expect_(
      { isActive: false, expiresAt: past },
      { kind: 'none', reasons: ['paused', 'expired', 'not_ax_organization'] }
    );
    // The AX organization's, its id in upper case in the environment (#698)
    const axOpen = await createCampaign(orgAx);
    const axExpired = await createCampaign(orgAx, { expiresAt: past });

    const listedB = await (await callerFor(orgB)).distribution.listCampaigns({
      organizationId: orgB,
    });
    const listedAx = await (await callerFor(orgAx)).distribution.listCampaigns({
      organizationId: orgAx,
    });

    // Each organization sees its own campaigns only
    expect(listedB.map((campaign) => campaign.shortCode).sort()).toEqual([...expected.keys()].sort());
    expect(listedAx.map((campaign) => campaign.shortCode).sort()).toEqual([axOpen, axExpired].sort());
    expect(listedAx.find((campaign) => campaign.shortCode === axOpen)?.destination).toEqual({
      kind: 'ax_diagnosis',
    });
    expect(listedAx.find((campaign) => campaign.shortCode === axExpired)?.destination).toEqual({
      kind: 'none',
      reasons: ['expired'],
    });

    for (const campaign of [...listedB, ...listedAx]) {
      const { destination, shortCode } = campaign;
      if (expected.has(shortCode)) expect(destination, shortCode).toEqual(expected.get(shortCode));
      const res = await scan(shortCode);
      if (destination.kind === 'none') {
        expect(res.status, shortCode).toBe(404);
      } else {
        expect(res.status, shortCode).toBe(307);
        const utm = {
          source: campaign.utmSource,
          medium: campaign.utmMedium,
          campaign: campaign.utmCampaign,
          content: campaign.utmContent,
        };
        const slug = destination.kind === 'diagnosis' ? destination.slug : null;
        expect(res.headers.get('location'), shortCode).toBe(qrEntryRedirectPath(utm, slug));
      }
    }
  });
});
