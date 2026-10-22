/**
 * The organization's hearing settings (#98): hidden fields, order and required fields applied to
 * the catalog, hidden fields with a value still shown, the stored settings read safely and no
 * prefill into hidden fields.
 */
import {
  HEARING_BASE_CATALOG,
  HEARING_REQUIRED_ITEMS,
  resolveHearingCatalog,
} from '@/lib/features/lead-hearings/catalog';
import {
  BASE_REQUIRED_KEYS,
  DEFAULT_HEARING_SETTINGS,
  hearingSettingsSchema,
  overridesFromSettings,
  readHearingSettings,
  requiredItemsFor,
} from '@/lib/features/lead-hearings/catalog-settings';
import { computeMissingItems } from '@/lib/features/lead-hearings/missing';
import { withoutHiddenFields } from '@/lib/features/lead-hearings/service';
import type { HearingFields } from '@/lib/features/lead-hearings/types/schemas';
import { describe, expect, it } from 'vitest';

const keysOf = (view: ReturnType<typeof resolveHearingCatalog>, section: string) =>
  view.sections.find((s) => s.id === section)?.fields.map((entry) => entry.field.key);

describe('resolveHearingCatalog with organization settings', () => {
  it('leaves out hidden fields, and drops them from the required items', () => {
    const view = resolveHearingCatalog(HEARING_BASE_CATALOG, {
      hidden: ['machineModel', 'decisionMakerPresent'],
    });
    expect(keysOf(view, 'meeting')).toEqual(['meetingFormat', 'attendeeRoles']);
    expect(keysOf(view, 'currentSystem')).not.toContain('machineModel');
    expect(view.sectionOf.has('machineModel')).toBe(false);
    // "system" keeps targetSystem; "decisionMaker" had only the hidden field and drops out
    expect(view.requiredItems.find((item) => item.id === 'system')?.keys).toEqual(['targetSystem']);
    expect(view.requiredItems.some((item) => item.id === 'decisionMaker')).toBe(false);
  });

  it('shows a hidden field a record has a value for', () => {
    const view = resolveHearingCatalog(HEARING_BASE_CATALOG, {
      hidden: ['machineModel'],
      show: ['machineModel'],
    });
    expect(keysOf(view, 'currentSystem')).toContain('machineModel');
  });

  it('orders the fields of a section, the rest following in the base order', () => {
    const view = resolveHearingCatalog(HEARING_BASE_CATALOG, {
      order: { meeting: ['decisionMakerPresent'] },
    });
    expect(keysOf(view, 'meeting')).toEqual([
      'decisionMakerPresent',
      'meetingFormat',
      'attendeeRoles',
    ]);
    expect(keysOf(view, 'customer')).toEqual(['industry', 'employeeCount', 'businessAreas']);
  });

  it('keeps the base required items when nothing changes', () => {
    expect(resolveHearingCatalog(HEARING_BASE_CATALOG, {}).requiredItems).toBe(
      HEARING_REQUIRED_ITEMS
    );
  });
});

describe('requiredItemsFor', () => {
  it('is the base items when the organization has not chosen', () => {
    expect(requiredItemsFor(null)).toBe(HEARING_REQUIRED_ITEMS);
  });

  it('keeps the chosen keys of the base items and adds other fields as items of their own', () => {
    const items = requiredItemsFor(['targetSystem', 'budgetStatus']);
    expect(items).toEqual([
      expect.objectContaining({ id: 'system', keys: ['targetSystem'] }),
      { id: 'field:budgetStatus', labelKey: 'leadHearings.fields.budgetStatus', keys: ['budgetStatus'] },
    ]);
    // The missing-item check follows them
    const missing = computeMissingItems({}, items);
    expect(missing.missing).toEqual(['system', 'field:budgetStatus']);
  });

  it('starts the settings screen from the base required fields', () => {
    expect(BASE_REQUIRED_KEYS).toContain('targetSystem');
    expect(BASE_REQUIRED_KEYS).not.toContain('budgetStatus');
    expect(requiredItemsFor(BASE_REQUIRED_KEYS)).toEqual(HEARING_REQUIRED_ITEMS);
  });
});

describe('hearing settings', () => {
  it('refuses a hidden field that is required, and unknown keys', () => {
    expect(
      hearingSettingsSchema.safeParse({ hidden: ['budgetStatus'], required: ['budgetStatus'] })
        .success
    ).toBe(false);
    expect(hearingSettingsSchema.safeParse({ hidden: ['notAField'] }).success).toBe(false);
    expect(hearingSettingsSchema.parse({ hidden: ['budgetStatus', 'budgetStatus'] })).toEqual({
      hidden: ['budgetStatus'],
      required: null,
      order: {},
    });
  });

  it('reads the stored settings, and broken ones as the defaults', () => {
    expect(readHearingSettings(null)).toEqual(DEFAULT_HEARING_SETTINGS);
    expect(readHearingSettings({ hearingCatalog: { hidden: ['nope'] } })).toEqual(
      DEFAULT_HEARING_SETTINGS
    );
    expect(
      readHearingSettings({
        other: 1,
        hearingCatalog: { hidden: ['machineModel'], required: null, order: {}, version: 3 },
      })
    ).toEqual({ hidden: ['machineModel'], required: null, order: {}, version: 3 });
  });

  it('turns the settings into catalog overrides', () => {
    const overrides = overridesFromSettings({
      hidden: ['machineModel'],
      required: ['targetSystem'],
      order: { meeting: ['attendeeRoles'] },
    });
    const view = resolveHearingCatalog(HEARING_BASE_CATALOG, overrides);
    expect(view.requiredItems.map((item) => item.id)).toEqual(['system']);
    expect(keysOf(view, 'meeting')?.[0]).toBe('attendeeRoles');
  });
});

describe('withoutHiddenFields', () => {
  it('drops the values of fields the organization does not ask', () => {
    const fields = {
      targetSystem: { value: 'as400', status: 'not_yet', source: 'prefilled' },
      machineModel: { value: 'X', status: 'not_yet', source: 'prefilled' },
    } as HearingFields;
    expect(Object.keys(withoutHiddenFields(fields, { hidden: ['machineModel'] }))).toEqual([
      'targetSystem',
    ]);
    expect(withoutHiddenFields(fields, {})).toBe(fields);
  });
});
