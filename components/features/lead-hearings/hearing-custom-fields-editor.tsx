'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { HEARING_SECTIONS, type HearingSectionId } from '@/lib/features/lead-hearings/catalog';
import {
  HEARING_CUSTOM_FIELDS_MAX,
  HEARING_CUSTOM_FIELD_TYPES,
  HEARING_CUSTOM_LABEL_MAX_LENGTH,
  HEARING_CUSTOM_OPTION_LABEL_MAX_LENGTH,
  type HearingCustomField,
  type HearingCustomFieldType,
  newHearingCustomId,
} from '@/lib/features/lead-hearings/catalog-settings';
import { HEARING_CUSTOM_OPTIONS_MAX } from '@/lib/features/lead-hearings/types/schemas';
import { Plus, RotateCcw, Trash2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId } from 'react';

const SELECT_CLASS =
  'h-9 rounded-md border border-input bg-background px-2 text-sm disabled:cursor-not-allowed disabled:opacity-50';

interface HearingCustomFieldsEditorProps {
  /** The fields in use (archived ones are not edited here) */
  fields: readonly HearingCustomField[];
  /** Fields removed earlier: kept so older records read, and can be brought back */
  archived: readonly HearingCustomField[];
  /** Ids already saved: their type stays (older values are of that type) */
  savedIds: ReadonlySet<string>;
  /** Option ids already saved: removing one keeps it archived */
  savedOptionIds: ReadonlySet<string>;
  canEdit: boolean;
  onAdd: (field: HearingCustomField) => void;
  onChange: (field: HearingCustomField) => void;
  onRemove: (id: string) => void;
  onRestore: (id: string) => void;
}

/**
 * The organization's own hearing fields (Refs #98): free text, one choice or several. Removing a
 * field or an option keeps it archived on save, so older records still read.
 */
export function HearingCustomFieldsEditor({
  fields,
  archived,
  savedIds,
  savedOptionIds,
  canEdit,
  onAdd,
  onChange,
  onRemove,
  onRestore,
}: HearingCustomFieldsEditorProps) {
  const t = useTranslations('leadHearings.settings.custom');
  const tSection = useTranslations('leadHearings.sections');
  const id = useId();

  const add = () =>
    onAdd({
      id: newHearingCustomId(),
      label: '',
      type: 'text',
      section: 'requirements',
      options: [],
    });
  const setType = (field: HearingCustomField, type: HearingCustomFieldType) =>
    onChange({
      ...field,
      type,
      options:
        type === 'text'
          ? []
          : field.options.length > 0
            ? field.options
            : [{ id: newHearingCustomId(), label: '' }],
    });

  return (
    <section className="space-y-3" aria-labelledby={`${id}-title`}>
      <div>
        <h3 id={`${id}-title`} className="text-sm font-semibold">
          {t('title')}
        </h3>
        <p className="text-xs text-muted-foreground">{t('description')}</p>
      </div>
      {fields.length === 0 && <p className="text-sm text-muted-foreground">{t('empty')}</p>}
      <ul className="space-y-3">
        {fields.map((field, index) => {
          const fieldId = `${id}-${field.id}`;
          const name = field.label || t('untitled', { number: index + 1 });
          const activeOptions = field.options.filter((o) => !o.archived);
          return (
            <li
              key={field.id}
              className="space-y-3 rounded-md border p-3"
              data-testid={`custom-field-${field.id}`}
            >
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-48 flex-1 space-y-1">
                  <Label htmlFor={`${fieldId}-label`} className="text-xs">
                    {t('label')}
                  </Label>
                  <Input
                    id={`${fieldId}-label`}
                    value={field.label}
                    maxLength={HEARING_CUSTOM_LABEL_MAX_LENGTH}
                    disabled={!canEdit}
                    onChange={(event) => onChange({ ...field, label: event.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`${fieldId}-type`} className="text-xs">
                    {t('type')}
                  </Label>
                  <select
                    id={`${fieldId}-type`}
                    className={`${SELECT_CLASS} block`}
                    value={field.type}
                    disabled={!canEdit || savedIds.has(field.id)}
                    onChange={(event) =>
                      setType(field, event.target.value as HearingCustomFieldType)
                    }
                  >
                    {HEARING_CUSTOM_FIELD_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {t(`types.${type}`)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`${fieldId}-section`} className="text-xs">
                    {t('section')}
                  </Label>
                  <select
                    id={`${fieldId}-section`}
                    className={`${SELECT_CLASS} block`}
                    value={field.section}
                    disabled={!canEdit}
                    onChange={(event) =>
                      onChange({ ...field, section: event.target.value as HearingSectionId })
                    }
                  >
                    {HEARING_SECTIONS.map((section) => (
                      <option key={section} value={section}>
                        {tSection(section)}
                      </option>
                    ))}
                  </select>
                </div>
                {canEdit && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={t('remove', { field: name })}
                    onClick={() => onRemove(field.id)}
                  >
                    <Trash2 className="mr-1 h-4 w-4" aria-hidden="true" />
                    {t('removeShort')}
                  </Button>
                )}
              </div>

              {field.type !== 'text' && (
                <fieldset className="space-y-2" disabled={!canEdit}>
                  <legend className="text-xs text-muted-foreground">{t('options')}</legend>
                  {activeOptions.map((option, optionIndex) => (
                    <div key={option.id} className="flex items-center gap-2">
                      <Input
                        aria-label={t('optionLabel', { field: name, number: optionIndex + 1 })}
                        value={option.label}
                        maxLength={HEARING_CUSTOM_OPTION_LABEL_MAX_LENGTH}
                        onChange={(event) =>
                          onChange({
                            ...field,
                            options: field.options.map((o) =>
                              o.id === option.id ? { ...o, label: event.target.value } : o
                            ),
                          })
                        }
                      />
                      {canEdit && activeOptions.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0"
                          aria-label={t('removeOption', {
                            option: option.label || String(optionIndex + 1),
                          })}
                          onClick={() =>
                            onChange({
                              ...field,
                              // A saved option is kept archived; a new one just goes
                              options: savedOptionIds.has(option.id)
                                ? field.options.map((o) =>
                                    o.id === option.id ? { ...o, archived: true } : o
                                  )
                                : field.options.filter((o) => o.id !== option.id),
                            })
                          }
                        >
                          <X className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      )}
                    </div>
                  ))}
                  {canEdit && activeOptions.length < HEARING_CUSTOM_OPTIONS_MAX && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        onChange({
                          ...field,
                          options: [...field.options, { id: newHearingCustomId(), label: '' }],
                        })
                      }
                    >
                      <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
                      {t('addOption')}
                    </Button>
                  )}
                </fieldset>
              )}
            </li>
          );
        })}
      </ul>
      {canEdit && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={fields.length >= HEARING_CUSTOM_FIELDS_MAX}
          onClick={add}
        >
          <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
          {t('add')}
        </Button>
      )}
      {archived.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">{t('archived')}</p>
          <ul className="divide-y rounded-md border">
            {archived.map((field) => (
              <li
                key={field.id}
                className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm"
              >
                <span className="min-w-0 truncate text-muted-foreground">{field.label}</span>
                {canEdit && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={fields.length >= HEARING_CUSTOM_FIELDS_MAX}
                    aria-label={t('restore', { field: field.label })}
                    onClick={() => onRestore(field.id)}
                  >
                    <RotateCcw className="mr-1 h-4 w-4" aria-hidden="true" />
                    {t('restoreShort')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
