/**
 * organizations.update keeps the settings of the other features (#483) on a real PostgreSQL:
 * five features each merge their own key into organizations.settings. The owner renames the
 * organization, with and without a settings field in the input, and every key is still there,
 * read back by the feature that wrote it. All values are fictional.
 *
 * Skipped unless TEST_DATABASE_URL points to a database with the drizzle migrations applied:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/dl_test \
 *     bunx vitest --run test/unit/integration/organizations-settings.db.test.ts
 */
import * as schema from '@/lib/db/schema';
import { organizationMembers, organizations, users } from '@/lib/db/schema';
import { getActTimingSettings, saveActTimingSettings } from '@/lib/features/act-timing/service';
import { getInfoOffers, saveInfoOffers } from '@/lib/features/info-offers/service';
import { DEFAULT_INFO_OFFERS } from '@/lib/features/info-offers/types/schemas';
import { getHandoffUserIds, setHandoffUserIds } from '@/lib/features/lead-handoff/settings';
import { hearingSettingsSchema } from '@/lib/features/lead-hearings/catalog-settings';
import { getHearingSettings, saveHearingSettings } from '@/lib/features/lead-hearings/settings';
import { getIntakeUserIds, setIntakeUserIds } from '@/lib/features/leads/assignment';
import { appRouter } from '@/server/routers/_app';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('organizations.update: other settings survive (PostgreSQL)', () => {
  const client = url ? postgres(url, { max: 2 }) : null;
  // biome-ignore lint/style/noNonNullAssertion: guarded by skipIf
  const pg = (client ? drizzle(client, { schema }) : null)!;
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let org: string;
  const userIds: string[] = [];
  // biome-ignore lint/suspicious/noExplicitAny: tRPC caller
  let owner: any;

  const actTiming = { migrationMonths: 18, noticeMonths: 2 };
  const hearing = hearingSettingsSchema.parse({ hidden: ['machineModel'] });
  const infoOffers = {
    ...DEFAULT_INFO_OFFERS,
    enabled: true,
    documents: [
      {
        id: 'checklist',
        title: '移行チェックリスト',
        description: '',
        url: 'https://example.com/c.pdf',
      },
    ],
  };

  const settingsOf = async () =>
    (
      await pg
        .select({ settings: organizations.settings })
        .from(organizations)
        .where(eq(organizations.id, org))
    )[0]?.settings;

  /** What each feature reads back from the settings it wrote */
  const featureSettings = async () => ({
    intake: await getIntakeUserIds(pg, org),
    handoff: await getHandoffUserIds(pg, org),
    actTiming: await getActTimingSettings(pg, org),
    hearing: await getHearingSettings(pg, org),
    infoOffers: await getInfoOffers(pg, org),
  });

  beforeAll(async () => {
    [{ id: org }] = await pg
      .insert(organizations)
      .values({ name: '設定保持テスト', slug: `orgs-settings-${unique()}` })
      .returning({ id: organizations.id });
    const [user, member] = await pg
      .insert(users)
      .values([
        { email: `orgs-settings-owner-${unique()}@example.com`, name: 'オーナー' },
        { email: `orgs-settings-member-${unique()}@example.com`, name: 'メンバー' },
      ])
      .returning();
    userIds.push(user.id, member.id);
    await pg.insert(organizationMembers).values([
      { organizationId: org, userId: user.id, role: 'owner' },
      { organizationId: org, userId: member.id, role: 'member' },
    ]);

    // Each feature writes its own key, the way its settings screen does
    await setIntakeUserIds(pg, org, [member.id]);
    await setHandoffUserIds(pg, org, [user.id, member.id]);
    await saveActTimingSettings(pg, org, actTiming);
    await saveHearingSettings(pg, org, hearing, 0);
    await saveInfoOffers(pg, org, infoOffers);

    owner = appRouter.createCaller({
      db: pg,
      session: { session: { id: 's', userId: user.id }, user },
      user,
      // biome-ignore lint/suspicious/noExplicitAny: test context
    } as any);
  });

  afterAll(async () => {
    if (org) await pg.delete(organizations).where(eq(organizations.id, org));
    if (userIds.length > 0) await pg.delete(users).where(inArray(users.id, userIds));
    await client?.end();
  });

  it('starts with the five keys the features wrote', async () => {
    expect(Object.keys((await settingsOf()) ?? {}).sort()).toEqual([
      'actTiming',
      'axInfoOffers',
      'hearingCatalog',
      'leadHandoffUserIds',
      'leadIntakeUserIds',
    ]);
    expect(await featureSettings()).toEqual({
      intake: [userIds[1]],
      handoff: userIds,
      actTiming,
      hearing: { ...hearing, version: 1 },
      infoOffers,
    });
  });

  it('keeps every key when the name and the slug change', async () => {
    const before = await settingsOf();
    const features = await featureSettings();
    const slug = `orgs-settings-renamed-${unique()}`;

    const updated = await owner.organizations.update({ id: org, name: '名前を変更', slug });

    expect(updated).toMatchObject({ name: '名前を変更', slug, settings: before });
    expect(await settingsOf()).toEqual(before);
    expect(await featureSettings()).toEqual(features);
  });

  it('ignores settings sent with the update (an empty object or other values)', async () => {
    const before = await settingsOf();
    const features = await featureSettings();

    await owner.organizations.update({ id: org, name: '空の設定', settings: {} });
    await owner.organizations.update({
      id: org,
      name: '別の設定',
      settings: { leadIntakeUserIds: [], actTiming: { migrationMonths: 1, noticeMonths: 0 } },
    });

    const [row] = await pg.select().from(organizations).where(eq(organizations.id, org));
    expect(row.name).toBe('別の設定');
    expect(row.settings).toEqual(before);
    expect(await featureSettings()).toEqual(features);
  });
});
