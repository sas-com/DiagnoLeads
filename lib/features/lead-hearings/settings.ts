/**
 * The organization's hearing settings (Refs #98) in the database: read and saved in
 * organizations.settings.hearingCatalog. The settings themselves are in ./catalog-settings.ts.
 */
import type { db as defaultDb } from '@/lib/db/client';
import { organizations } from '@/lib/db/schema';
import { eq, sql } from 'drizzle-orm';
import type { HearingCatalogOverrides } from './catalog';
import {
  HEARING_SETTINGS_KEY,
  type HearingSettings,
  type StoredHearingSettings,
  overridesFromSettings,
  readHearingSettings,
} from './catalog-settings';

type Executor = Pick<typeof defaultDb, 'select' | 'update'>;

export { hearingSettingsSchema } from './catalog-settings';

export async function getHearingSettings(
  db: Pick<typeof defaultDb, 'select'>,
  organizationId: string
): Promise<StoredHearingSettings> {
  const [row] = await db
    .select({ settings: organizations.settings })
    .from(organizations)
    .where(eq(organizations.id, organizationId));
  return readHearingSettings(row?.settings);
}

/** The organization's catalog overrides */
export async function getHearingOverrides(
  db: Pick<typeof defaultDb, 'select'>,
  organizationId: string
): Promise<HearingCatalogOverrides> {
  return overridesFromSettings(await getHearingSettings(db, organizationId));
}

/** Save the settings (merged into organizations.settings); returns the new version */
export async function saveHearingSettings(
  db: Executor,
  organizationId: string,
  settings: HearingSettings,
  previousVersion: number
): Promise<number> {
  const stored: StoredHearingSettings = { ...settings, version: previousVersion + 1 };
  await db
    .update(organizations)
    .set({
      settings: sql`coalesce(${organizations.settings}, '{}'::jsonb) || jsonb_build_object(${HEARING_SETTINGS_KEY}::text, ${JSON.stringify(stored)}::jsonb)`,
      updatedAt: new Date(),
    })
    .where(eq(organizations.id, organizationId));
  return stored.version;
}
