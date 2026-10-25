/**
 * The organization's hearing settings in the database (lib/features/lead-hearings/settings.ts,
 * #98) without a database (#6): read from the organization's own row (locked when saving), read
 * as the defaults when nothing usable is stored, and saved by merging only the hearing key with
 * the next version. The database is test/mocks/recording-db.ts; the same functions on a real
 * PostgreSQL are covered by test/unit/integration/organizations-settings.db.test.ts. What the
 * stored value may hold is tested in lead-hearings-catalog-settings.test.ts.
 */
import { organizations } from '@/lib/db/schema';
import {
  DEFAULT_HEARING_SETTINGS,
  HEARING_SETTINGS_KEY,
  type HearingSettings,
  customFieldKey,
} from '@/lib/features/lead-hearings/catalog-settings';
import {
  getHearingOverrides,
  getHearingSettings,
  saveHearingSettings,
} from '@/lib/features/lead-hearings/settings';
import { type RecordingDb, recordingDb, sqlOf } from '@/test/mocks/recording-db';
import { beforeEach, describe, expect, it } from 'vitest';

type Database = Parameters<typeof saveHearingSettings>[0];

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';

const settings: HearingSettings = {
  hidden: ['industry'],
  required: null,
  order: {},
  customFields: [
    { id: 'abcd1234', label: '社内の決裁者', type: 'text', section: 'customer', options: [] },
    {
      id: 'zzzz9999',
      label: '古い項目',
      type: 'text',
      section: 'customer',
      options: [],
      archived: true,
    },
  ],
};

let fake: RecordingDb;
const db = () => fake.db as unknown as Database;

beforeEach(() => {
  fake = recordingDb();
});

describe('getHearingSettings', () => {
  it("reads the settings stored on the organization's own row", async () => {
    fake.results.push([{ settings: { [HEARING_SETTINGS_KEY]: { ...settings, version: 3 } } }]);

    const stored = await getHearingSettings(db(), ORG_ID);

    expect(stored.version).toBe(3);
    expect(stored.hidden).toEqual(['industry']);
    expect(stored.customFields.map((field) => field.id)).toEqual(['abcd1234', 'zzzz9999']);
    const [call] = fake.calls;
    expect(call).toMatchObject({ op: 'select', table: organizations });
    expect(sqlOf(call.where)).toEqual({ sql: '"organizations"."id" = $1', params: [ORG_ID] });
    expect(call.lock).toBeUndefined();
  });

  it('locks the row when it is read for a save, so two saves get one version after the other', async () => {
    fake.results.push([{ settings: {} }]);

    await getHearingSettings(db(), ORG_ID, { forUpdate: true });

    expect(fake.calls[0].lock).toEqual({ strength: 'update', config: undefined });
  });

  it.each([
    ['an unknown organization', []],
    ['an organization without settings', [{ settings: null }]],
    ['settings without the hearing key', [{ settings: { leadIntakeUserIds: [] } }]],
    ['a broken hearing value', [{ settings: { [HEARING_SETTINGS_KEY]: 'broken' } }]],
  ])('reads %s as the defaults', async (_label, rows) => {
    fake.results.push(rows);

    expect(await getHearingSettings(db(), ORG_ID)).toEqual(DEFAULT_HEARING_SETTINGS);
  });
});

describe('getHearingOverrides', () => {
  it("turns the organization's settings into catalog overrides, hiding archived own fields", async () => {
    fake.results.push([{ settings: { [HEARING_SETTINGS_KEY]: { ...settings, version: 1 } } }]);

    const overrides = await getHearingOverrides(db(), ORG_ID);

    expect(overrides.hidden).toEqual(['industry', customFieldKey('zzzz9999')]);
    expect(overrides.customFields?.map((field) => field.key)).toEqual([
      customFieldKey('abcd1234'),
      customFieldKey('zzzz9999'),
    ]);
    expect(sqlOf(fake.calls[0].where).params).toEqual([ORG_ID]);
  });
});

describe('saveHearingSettings', () => {
  it('merges only the hearing key into the settings, with the next version', async () => {
    const before = Date.now();

    const version = await saveHearingSettings(db(), ORG_ID, settings, 4);

    expect(version).toBe(5);
    const [call] = fake.calls;
    expect(call).toMatchObject({ op: 'update', table: organizations });
    expect(sqlOf(call.where)).toEqual({ sql: '"organizations"."id" = $1', params: [ORG_ID] });
    const merge = sqlOf(call.set?.settings as Parameters<typeof sqlOf>[0]);
    // Other settings saved at the same time (intake members, the playbook) are kept
    expect(merge.sql).toBe(
      `coalesce("organizations"."settings", '{}'::jsonb) || jsonb_build_object($1::text, $2::jsonb)`
    );
    expect(merge.params[0]).toBe(HEARING_SETTINGS_KEY);
    expect(JSON.parse(merge.params[1] as string)).toEqual({ ...settings, version: 5 });
    expect((call.set?.updatedAt as Date).getTime()).toBeGreaterThanOrEqual(before);
  });
});
