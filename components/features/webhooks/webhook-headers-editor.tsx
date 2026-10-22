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
  type WebhookHeaderInput,
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

/** A row is complete when it has a name and, unless the stored value is kept, a value */
export function isRowComplete(row: WebhookHeaderRow): boolean {
  if (row.stored && !row.replacing) return true;
  return row.name.trim() !== '' && row.value !== '';
}

/** The update input: a stored header left as is is sent without a value, so it is kept */
export function rowsToHeaderInput(rows: WebhookHeaderRow[]): WebhookHeaderInput[] {
  return rows.map((row) =>
    row.stored && !row.replacing ? { name: row.name } : { name: row.name.trim(), value: row.value }
  );
}

/** The create input: every value is new */
export function rowsToHeaderRecord(rows: WebhookHeaderRow[]): Record<string, string> {
  return Object.fromEntries(rows.map((row) => [row.name.trim(), row.value]));
}

interface WebhookHeadersEditorProps {
  rows: WebhookHeaderRow[];
  onChange: (rows: WebhookHeaderRow[]) => void;
}

export function WebhookHeadersEditor({ rows, onChange }: WebhookHeadersEditorProps) {
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
      {rows.map((row) => {
        const masked = row.stored && !row.replacing;
        return (
          <div key={row.key} className="flex flex-col gap-2 sm:flex-row sm:items-center">
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
