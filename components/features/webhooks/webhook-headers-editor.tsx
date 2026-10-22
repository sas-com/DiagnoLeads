'use client';

/**
 * Custom headers of a webhook (#314). Stored values are never sent to the browser: a stored
 * header shows a mask and keeps its value unless the user chooses to enter a new one.
 */

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  type MaskedWebhookHeader,
  WEBHOOK_HEADER_MASK,
  WEBHOOK_HEADER_VALUE_MAX_LENGTH,
  WEBHOOK_HEADER_VALUE_PATTERN,
  type WebhookHeaderInput,
  isValidWebhookHeaderName,
} from '@/lib/features/webhooks/services/webhook-headers';
import { Plus, Trash2, Undo2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

export interface WebhookHeaderRow {
  key: string;
  name: string;
  value: string;
  /** The header is stored: its value is not known here */
  stored: boolean;
  /** A stored header whose value the user is entering again */
  replacing: boolean;
}

let rowSequence = 0;
const nextKey = () => {
  rowSequence += 1;
  return `header-${rowSequence}`;
};

/** Rows for the stored headers of a webhook, values masked */
export function rowsFromMaskedHeaders(headers: MaskedWebhookHeader[]): WebhookHeaderRow[] {
  return headers.map(({ name }) => ({
    key: nextKey(),
    name,
    value: '',
    stored: true,
    replacing: false,
  }));
}

/** A new name the server would refuse (reserved, spaces, symbols, too long) */
const hasInvalidName = (row: WebhookHeaderRow) =>
  !row.stored && row.name.trim() !== '' && !isValidWebhookHeaderName(row.name.trim());

/** A value the server would refuse (not printable ASCII, or too long) */
const hasInvalidValue = (row: WebhookHeaderRow) =>
  (!row.stored || row.replacing) &&
  (row.value.length > WEBHOOK_HEADER_VALUE_MAX_LENGTH ||
    !WEBHOOK_HEADER_VALUE_PATTERN.test(row.value));

/**
 * A row is complete when it has a valid name and, unless the stored value is kept, a value of
 * printable ASCII
 */
export function isRowComplete(row: WebhookHeaderRow): boolean {
  if (row.stored && !row.replacing) return true;
  if (!row.stored && !isValidWebhookHeaderName(row.name.trim())) return false;
  return (
    row.value !== '' &&
    row.value.length <= WEBHOOK_HEADER_VALUE_MAX_LENGTH &&
    WEBHOOK_HEADER_VALUE_PATTERN.test(row.value)
  );
}

/** Whether a name is given twice; header names do not depend on case */
export function hasDuplicateNames(rows: WebhookHeaderRow[]): boolean {
  const names = rows.map((row) => row.name.trim().toLowerCase());
  return new Set(names).size !== names.length;
}

/** Whether a stored value would be kept (not entered again) */
export const keepsStoredValue = (rows: WebhookHeaderRow[]) =>
  rows.some((row) => row.stored && !row.replacing);

/** Every stored header in replace mode: its value must be entered again */
export const replaceAllStoredValues = (rows: WebhookHeaderRow[]): WebhookHeaderRow[] =>
  rows.map((row) => (row.stored && !row.replacing ? { ...row, replacing: true, value: '' } : row));

/** The update input: a stored header left as is is sent without a value, so it is kept */
export function rowsToHeaderInput(rows: WebhookHeaderRow[]): WebhookHeaderInput[] {
  return rows.map((row) =>
    row.stored && !row.replacing ? { name: row.name } : { name: row.name.trim(), value: row.value }
  );
}

/** The create input: every value is new */
export function rowsToNewHeaders(rows: WebhookHeaderRow[]): { name: string; value: string }[] {
  return rows.map((row) => ({ name: row.name.trim(), value: row.value }));
}

interface WebhookHeadersEditorProps {
  rows: WebhookHeaderRow[];
  onChange: (rows: WebhookHeaderRow[]) => void;
  /** The URL's origin differs from the saved one: stored values must be entered again */
  reentryRequired?: boolean;
}

export function WebhookHeadersEditor({
  rows,
  onChange,
  reentryRequired = false,
}: WebhookHeadersEditorProps) {
  const t = useTranslations('settings.webhooks');

  const update = (key: string, patch: Partial<WebhookHeaderRow>) =>
    onChange(rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  const remove = (key: string) => onChange(rows.filter((row) => row.key !== key));
  const add = () =>
    onChange([...rows, { key: nextKey(), name: '', value: '', stored: false, replacing: false }]);

  return (
    <div className="grid gap-2">
      <Label>{t('headers')}</Label>
      <p className="text-sm text-muted-foreground">{t('headersDescription')}</p>
      {reentryRequired && (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-md border border-destructive/50 p-3 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between"
        >
          <span>{t('headersReentryRequired')}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onChange(replaceAllStoredValues(rows))}
          >
            {t('replaceAllHeaderValues')}
          </Button>
        </div>
      )}
      {hasDuplicateNames(rows) && (
        <p role="alert" className="text-sm text-destructive">
          {t('headerNameDuplicate')}
        </p>
      )}
      {rows.map((row) => {
        const masked = row.stored && !row.replacing;
        return (
          <div key={row.key} className="grid gap-1">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Input
                aria-label={t('headerName')}
                placeholder={t('headerName')}
                value={row.name}
                readOnly={row.stored}
                onChange={(e) => update(row.key, { name: e.target.value })}
                className="sm:w-1/3"
              />
              <Input
                aria-label={t('headerValueOf', { name: row.name })}
                placeholder={t('headerValue')}
                type={masked ? 'text' : 'password'}
                autoComplete="new-password"
                value={masked ? WEBHOOK_HEADER_MASK : row.value}
                readOnly={masked}
                onChange={(e) => update(row.key, { value: e.target.value })}
                className="flex-1 font-mono"
              />
              <div className="flex items-center gap-1">
                {row.stored &&
                  (row.replacing ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => update(row.key, { replacing: false, value: '' })}
                    >
                      <Undo2 className="mr-1 h-4 w-4" />
                      {t('keepHeaderValue')}
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => update(row.key, { replacing: true, value: '' })}
                    >
                      {t('replaceHeaderValue')}
                    </Button>
                  ))}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t('removeHeader', { name: row.name })}
                  onClick={() => remove(row.key)}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </div>
            {hasInvalidName(row) && (
              <p className="text-sm text-destructive">{t('headerNameInvalid')}</p>
            )}
            {hasInvalidValue(row) && (
              <p className="text-sm text-destructive">{t('headerValueInvalid')}</p>
            )}
          </div>
        );
      })}
      <div>
        <Button type="button" variant="outline" size="sm" onClick={add}>
          <Plus className="mr-1 h-4 w-4" />
          {t('addHeader')}
        </Button>
      </div>
    </div>
  );
}
