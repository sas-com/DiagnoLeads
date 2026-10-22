'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { HEARING_BASE_CATALOG, HEARING_SECTIONS } from '@/lib/features/lead-hearings/catalog';
import {
  BASE_REQUIRED_KEYS,
  type HearingCustomField,
  type HearingSettings,
  customFieldKey,
  hearingSettingsSchema,
} from '@/lib/features/lead-hearings/catalog-settings';
import { trpc } from '@/lib/trpc/client';
import { ArrowDown, ArrowUp, Loader2, RotateCcw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useState } from 'react';
import { toast } from 'sonner';
import { HearingCustomFieldsEditor } from './hearing-custom-fields-editor';

interface Draft {
  hidden: Set<string>;
  required: Set<string>;
  order: Record<string, string[]>;
  /** The organization's own fields in use */
  custom: HearingCustomField[];
  /** Archived own fields: sent back as they are */
  archived: HearingCustomField[];
}

/** The order with nothing changed: base fields, then the own fields of the section */
const baseOrder = (custom: readonly HearingCustomField[]): Record<string, string[]> =>
  Object.fromEntries(
    HEARING_SECTIONS.map((section) => [
      section,
      [
        ...HEARING_BASE_CATALOG.fields.filter((f) => f.section === section).map((f) => f.key),
        ...custom.filter((f) => f.section === section).map((f) => customFieldKey(f.id)),
      ],
    ])
  );

function toDraft(
  settings: Pick<HearingSettings, 'hidden' | 'required' | 'order'>,
  allCustom: readonly HearingCustomField[]
): Draft {
  const custom = allCustom.filter((field) => !field.archived);
  const order = baseOrder(custom);
  for (const section of HEARING_SECTIONS) {
    const saved: readonly string[] = settings.order[section] ?? [];
    const rank = (key: string) => {
      const index = saved.indexOf(key);
      return index === -1 ? saved.length : index;
    };
    order[section] = [...order[section]].sort((a, b) => rank(a) - rank(b));
  }
  return {
    hidden: new Set(settings.hidden),
    required: new Set<string>(settings.required ?? BASE_REQUIRED_KEYS),
    order,
    custom,
    archived: allCustom.filter((field) => field.archived),
  };
}

/**
 * The organization's hearing fields (Refs #98): which are asked, which are required and in which
 * order. Owners and admins change them; records keep their values whatever is changed.
 */
export function HearingSettingsCard({ organizationId }: { organizationId: string }) {
  const t = useTranslations('leadHearings.settings');
  const tSection = useTranslations('leadHearings.sections');
  const tRoot = useTranslations();
  const id = useId();
  const utils = trpc.useUtils();
  const query = trpc.leadHearings.catalogSettings.useQuery({ organizationId }, { retry: false });
  const [draft, setDraft] = useState<Draft | null>(null);
  const save = trpc.leadHearings.updateCatalogSettings.useMutation({
    onSuccess: () => {
      utils.leadHearings.catalogSettings.invalidate({ organizationId });
      toast.success(t('saved'));
    },
    onError: (error) =>
      toast.error(error.data?.code === 'CONFLICT' ? t('conflict') : t('saveError')),
  });

  useEffect(() => {
    if (query.data) setDraft(toDraft(query.data.settings, query.data.settings.customFields ?? []));
  }, [query.data]);

  if (query.isError) return null;
  const canEdit = !!query.data?.canEdit;
  const labelOf = (key: string) => {
    const field = HEARING_BASE_CATALOG.fields.find((item) => item.key === key);
    if (field) return tRoot(field.labelKey);
    const own = draft?.custom.find((item) => customFieldKey(item.id) === key);
    return own?.label || t('custom.untitledShort');
  };
  const savedFields = query.data?.settings.customFields ?? [];
  const savedIds = new Set(savedFields.map((field) => field.id));
  const savedOptionIds = new Set(savedFields.flatMap((field) => field.options.map((o) => o.id)));

  const addCustom = (field: HearingCustomField) => {
    if (!draft) return;
    const key = customFieldKey(field.id);
    setDraft({
      ...draft,
      custom: [...draft.custom, field],
      order: { ...draft.order, [field.section]: [...draft.order[field.section], key] },
    });
  };
  const changeCustom = (field: HearingCustomField) => {
    if (!draft) return;
    const key = customFieldKey(field.id);
    const previous = draft.custom.find((item) => item.id === field.id);
    let order = draft.order;
    // A field moved to another section goes to the end of it
    if (previous && previous.section !== field.section) {
      order = {
        ...order,
        [previous.section]: order[previous.section].filter((k) => k !== key),
        [field.section]: [...order[field.section], key],
      };
    }
    setDraft({
      ...draft,
      order,
      custom: draft.custom.map((item) => (item.id === field.id ? field : item)),
    });
  };
  const removeCustom = (fieldId: string) => {
    if (!draft) return;
    const key = customFieldKey(fieldId);
    const without = (set: Set<string>) => new Set([...set].filter((k) => k !== key));
    const removed = draft.custom.find((item) => item.id === fieldId);
    setDraft({
      ...draft,
      custom: draft.custom.filter((item) => item.id !== fieldId),
      // A saved field is kept archived (older records read it); a new one just goes
      archived:
        removed && savedIds.has(fieldId)
          ? [...draft.archived, { ...removed, archived: true }]
          : draft.archived,
      hidden: without(draft.hidden),
      required: without(draft.required),
      order: Object.fromEntries(
        Object.entries(draft.order).map(([section, keys]) => [
          section,
          keys.filter((k) => k !== key),
        ])
      ),
    });
  };

  const restoreCustom = (fieldId: string) => {
    if (!draft) return;
    const field = draft.archived.find((item) => item.id === fieldId);
    if (!field) return;
    const restored = { ...field, archived: undefined };
    setDraft({
      ...draft,
      archived: draft.archived.filter((item) => item.id !== fieldId),
      custom: [...draft.custom, restored],
      order: {
        ...draft.order,
        [field.section]: [...draft.order[field.section], customFieldKey(fieldId)],
      },
    });
  };

  const toggle = (which: 'hidden' | 'required', key: string, on: boolean) => {
    if (!draft) return;
    const next = new Set(draft[which]);
    if (on) next.add(key);
    else next.delete(key);
    const updated = { ...draft, [which]: next };
    // A field that is not asked is not required either
    if (which === 'hidden' && on)
      updated.required = new Set([...draft.required].filter((k) => k !== key));
    setDraft(updated);
  };
  const move = (section: string, index: number, by: -1 | 1) => {
    if (!draft) return;
    const list = [...draft.order[section]];
    const target = index + by;
    if (target < 0 || target >= list.length) return;
    [list[index], list[target]] = [list[target], list[index]];
    setDraft({ ...draft, order: { ...draft.order, [section]: list } });
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft) return;
    // Only what differs from the base is kept, so fields and required items added to the base
    // later reach the organization too
    const base = baseOrder(draft.custom);
    const required = [...draft.required].filter((key) => !draft.hidden.has(key));
    const baseRequired = BASE_REQUIRED_KEYS.filter((key) => !draft.hidden.has(key));
    const sameRequired =
      required.length === baseRequired.length &&
      baseRequired.every((key) => draft.required.has(key));
    const parsed = hearingSettingsSchema.safeParse({
      hidden: [...draft.hidden],
      required: sameRequired ? null : required,
      order: Object.fromEntries(
        HEARING_SECTIONS.filter(
          (section) => draft.order[section].join() !== base[section].join()
        ).map((section) => [section, draft.order[section]])
      ),
      customFields: [
        ...draft.custom.map((field) => ({
          ...field,
          label: field.label.trim(),
          // Options left empty are dropped
          options: field.options
            .map((o) => ({ ...o, label: o.label.trim() }))
            .filter((o) => o.label !== ''),
        })),
        ...draft.archived,
      ],
    });
    if (!parsed.success) {
      toast.error(t('custom.invalid'));
      return;
    }
    save.mutate({
      organizationId,
      settings: parsed.data,
      expectedVersion: query.data?.settings.version ?? 0,
    });
  };

  return (
    <Card id="hearing-settings">
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent>
        {!draft ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden="true" />
        ) : (
          <form onSubmit={submit} className="space-y-6">
            {HEARING_SECTIONS.map((section) => (
              <fieldset key={section} className="space-y-1" disabled={!canEdit}>
                <legend className="mb-1 text-sm font-semibold">{tSection(section)}</legend>
                <ul className="divide-y rounded-md border">
                  {draft.order[section].map((key, index) => {
                    const label = labelOf(key);
                    const asked = !draft.hidden.has(key);
                    return (
                      <li
                        key={key}
                        className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm"
                        data-testid={`hearing-setting-${key}`}
                      >
                        <span
                          className={`min-w-0 flex-1 ${asked ? '' : 'text-muted-foreground line-through'}`}
                        >
                          {label}
                        </span>
                        <label
                          className="flex items-center gap-1.5 text-xs"
                          htmlFor={`${id}-asked-${key}`}
                        >
                          <Checkbox
                            id={`${id}-asked-${key}`}
                            checked={asked}
                            aria-label={t('askedLabel', { field: label })}
                            onCheckedChange={(value) => toggle('hidden', key, value !== true)}
                          />
                          {t('asked')}
                        </label>
                        <label
                          className="flex items-center gap-1.5 text-xs"
                          htmlFor={`${id}-required-${key}`}
                        >
                          <Checkbox
                            id={`${id}-required-${key}`}
                            checked={asked && draft.required.has(key)}
                            disabled={!asked || !canEdit}
                            aria-label={t('requiredLabel', { field: label })}
                            onCheckedChange={(value) => toggle('required', key, value === true)}
                          />
                          {t('required')}
                        </label>
                        {canEdit && (
                          <span className="flex gap-1">
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8"
                              disabled={index === 0}
                              aria-label={t('moveUp', { field: label })}
                              onClick={() => move(section, index, -1)}
                            >
                              <ArrowUp className="h-4 w-4" aria-hidden="true" />
                            </Button>
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8"
                              disabled={index === draft.order[section].length - 1}
                              aria-label={t('moveDown', { field: label })}
                              onClick={() => move(section, index, 1)}
                            >
                              <ArrowDown className="h-4 w-4" aria-hidden="true" />
                            </Button>
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </fieldset>
            ))}
            <HearingCustomFieldsEditor
              fields={draft.custom}
              archived={draft.archived}
              savedIds={savedIds}
              savedOptionIds={savedOptionIds}
              onRestore={restoreCustom}
              canEdit={canEdit}
              onAdd={addCustom}
              onChange={changeCustom}
              onRemove={removeCustom}
            />
            {canEdit ? (
              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={save.isPending}>
                  {save.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                  {t('save')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    // The own fields stay; only what is asked, required and the order go back
                    setDraft(
                      toDraft({ hidden: [], required: null, order: {} }, [
                        ...draft.custom,
                        ...draft.archived,
                      ])
                    )
                  }
                >
                  <RotateCcw className="mr-1 h-4 w-4" aria-hidden="true" />
                  {t('reset')}
                </Button>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">{t('readOnly')}</p>
            )}
            <p className="text-xs text-muted-foreground">{t('note')}</p>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
