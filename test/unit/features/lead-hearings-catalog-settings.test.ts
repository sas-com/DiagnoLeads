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
  customFieldDefinition,
  hearingCustomFieldSchema,
  hearingSettingsSchema,
  mergeCustomFields,
  overridesFromSettings,
  readHearingSettings,
  requiredItemsFor,
} from '@/lib/features/lead-hearings/catalog-settings';
import { computeMissingItems } from '@/lib/features/lead-hearings/missing';
import { toSavedHearingFields } from '@/lib/features/lead-hearings/form';
import {
  assertCustomFieldValues,
  withoutHiddenFields,
} from '@/lib/features/lead-hearings/service';
import {
  type HearingFields,
  hearingFieldsSchema,
  parseStoredHearingFields,
} from '@/lib/features/lead-hearings/types/schemas';
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
    // ...but not as required, so the screens agree with the missing count of the list
    expect(view.requiredItems.find((item) => item.id === 'system')?.keys).toEqual(['targetSystem']);
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
      customFields: [],
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
    ).toEqual({
      hidden: ['machineModel'],
      required: null,
      order: {},
      customFields: [],
      version: 3,
    });
  });

  it('keeps the rest of the settings when a stored key is no longer in the catalog', () => {
    expect(
      readHearingSettings({
        hearingCatalog: {
          hidden: ['machineModel', 'removedField'],
          required: ['targetSystem', 'removedField', 'machineModel'],
          order: { meeting: ['removedField', 'attendeeRoles'], unknownSection: ['x'] },
          version: 4,
        },
      })
    ).toEqual({
      hidden: ['machineModel'],
      required: ['targetSystem'],
      order: { meeting: ['attendeeRoles'] },
      customFields: [],
      version: 4,
    });
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

describe("the organization's own fields", () => {
  const select = {
    id: 'aaaa1111',
    label: '導入時期の希望',
    type: 'single' as const,
    section: 'requirements' as const,
    options: [
      { id: 'opt00001', label: '今期' },
      { id: 'opt00002', label: '来期', archived: true },
    ],
  };
  const note = {
    id: 'bbbb2222',
    label: '社内の呼び名',
    type: 'text' as const,
    section: 'customer' as const,
    options: [],
  };

  it('become catalog fields after the base fields of their section', () => {
    const view = resolveHearingCatalog(
      HEARING_BASE_CATALOG,
      overridesFromSettings(
        hearingSettingsSchema.parse({ customFields: [select, note], required: ['custom:aaaa1111'] })
      )
    );
    expect(keysOf(view, 'customer')).toEqual([
      'industry',
      'employeeCount',
      'businessAreas',
      'custom:bbbb2222',
    ]);
    expect(view.fieldOf('custom:aaaa1111')).toMatchObject({ label: '導入時期の希望', type: 'single' });
    expect(view.requiredItems).toEqual([
      {
        id: 'field:custom:aaaa1111',
        labelKey: '',
        label: '導入時期の希望',
        keys: ['custom:aaaa1111'],
      },
    ]);
  });

  it('offers an archived option in the editor only where the record chose it', () => {
    const options = (selected?: unknown) => {
      const field = customFieldDefinition(select, selected);
      return field.type === 'single' ? field.options.map((o) => o.value) : [];
    };
    expect(options(null)).toEqual(['opt00001']);
    expect(options('opt00002')).toEqual(['opt00001', 'opt00002']);
    // Reading and checking saved values: every option
    expect(options()).toEqual(['opt00001', 'opt00002']);
  });

  it('keeps fields and options taken away archived, and a saved field keeps its type', () => {
    const merged = mergeCustomFields(
      [select, note],
      [{ ...select, type: 'multiple', options: [{ id: 'opt00003', label: '未定' }] }]
    );
    expect(merged).toEqual([
      {
        ...select,
        type: 'single',
        options: [
          { id: 'opt00003', label: '未定' },
          { id: 'opt00001', label: '今期', archived: true },
          { id: 'opt00002', label: '来期', archived: true },
        ],
      },
      { ...note, archived: true },
    ]);
  });

  it('refuses a choice field without options and fields that are not defined', () => {
    expect(
      hearingSettingsSchema.safeParse({ customFields: [{ ...select, options: [] }] }).success
    ).toBe(false);
    expect(hearingSettingsSchema.safeParse({ hidden: ['custom:zzzz9999'] }).success).toBe(false);
    expect(
      hearingSettingsSchema.safeParse({
        customFields: [{ ...note, archived: true }],
        required: ['custom:bbbb2222'],
      }).success
    ).toBe(false);
  });

  it('limits the fields and options in use, not the archived ones kept for older records', () => {
    const field = (n: number, archived = false) => ({
      ...note,
      id: `f${String(n).padStart(7, '0')}`,
      ...(archived ? { archived: true } : {}),
    });
    const many = (inUse: number, kept: number) =>
      Array.from({ length: inUse + kept }, (_, n) => field(n, n >= inUse));
    expect(hearingSettingsSchema.safeParse({ customFields: many(30, 40) }).success).toBe(true);
    expect(hearingSettingsSchema.safeParse({ customFields: many(31, 0) }).success).toBe(false);
    const options = (inUse: number, kept: number) =>
      Array.from({ length: inUse + kept }, (_, n) => ({
        id: `o${String(n).padStart(7, '0')}`,
        label: `${n}`,
        ...(n >= inUse ? { archived: true } : {}),
      }));
    expect(hearingCustomFieldSchema.safeParse({ ...select, options: options(30, 50) }).success).toBe(
      true
    );
    expect(hearingCustomFieldSchema.safeParse({ ...select, options: options(31, 0) }).success).toBe(
      false
    );
  });

  it('reads the stored own fields one by one, leaving out broken ones', () => {
    const settings = readHearingSettings({
      hearingCatalog: {
        customFields: [note, { id: 'BAD', label: '' }, note],
        hidden: ['custom:bbbb2222', 'custom:zzzz9999'],
      },
    });
    expect(settings.customFields).toEqual([note]);
    expect(settings.hidden).toEqual(['custom:bbbb2222']);
  });
});

describe('values of own fields', () => {
  const overrides = overridesFromSettings(
    hearingSettingsSchema.parse({
      customFields: [
        {
          id: 'aaaa1111',
          label: '導入時期の希望',
          type: 'multiple',
          section: 'requirements',
          options: [
            { id: 'opt00001', label: '今期' },
            { id: 'opt00002', label: '来期', archived: true },
          ],
        },
      ],
    })
  );
  const entry = (value: unknown) => ({ value, status: 'done', source: null });

  it('are saved and read by their shape, and checked against the settings on the server', () => {
    const fields = { 'custom:aaaa1111': entry(['opt00002']) };
    expect(hearingFieldsSchema.safeParse(fields).success).toBe(true);
    expect(hearingFieldsSchema.safeParse({ 'custom:x': entry('a') }).success).toBe(false);
    expect(hearingFieldsSchema.safeParse({ notAField: entry('a') }).success).toBe(false);
    expect(parseStoredHearingFields(fields)).toEqual({ fields, droppedKeys: [] });

    // An archived option still saves (older records stay as they are); an unknown one does not
    expect(() => assertCustomFieldValues(fields as HearingFields, overrides)).not.toThrow();
    expect(() =>
      assertCustomFieldValues({ 'custom:aaaa1111': entry(['nope0000']) } as HearingFields, overrides)
    ).toThrow();
    expect(() =>
      assertCustomFieldValues({ 'custom:cccc3333': entry('x') } as HearingFields, overrides)
    ).toThrow();
    // ...unless the record already has it unchanged (settings that broke must not block saving)
    const stored = { 'custom:cccc3333': entry('x') } as HearingFields;
    expect(() => assertCustomFieldValues(stored, overrides, stored)).not.toThrow();
  });

  it('are sent as they are when the screen does not know the field', () => {
    const form = {
      'custom:aaaa1111': entry(['opt00001']),
      'custom:dddd4444': entry('kept'),
    } as HearingFields;
    expect(toSavedHearingFields(form, overrides.customFields)).toEqual(form);
    // An empty own field the screen knows is not saved
    expect(
      toSavedHearingFields(
        { 'custom:aaaa1111': { status: 'not_yet', source: null } } as HearingFields,
        overrides.customFields
      )
    ).toEqual({});
  });
});
