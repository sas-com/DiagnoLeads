'use client';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useOrganization } from '@/hooks/use-organization';
import { GLOSSARY_FIELDS, type GlossaryField } from '@/lib/features/field-glossary/types/fields';
import { FIELD_GLOSSARY_DESCRIPTION_MAX } from '@/lib/features/field-glossary/types/schemas';
import type { RouterOutputs } from '@/lib/trpc/client';
import { trpc } from '@/lib/trpc/client';
import { AlertTriangle, Loader2, Lock, RefreshCw, Save, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { toast } from 'sonner';

type Entry = RouterOutputs['fieldGlossary']['listForEditor']['entries'][number];

const FIELDS: readonly GlossaryField[] = GLOSSARY_FIELDS;

/**
 * Edit the site-wide help shown next to input fields (#800): pick a listed field, then write the
 * field's own description and one for each of its values. Owners and admins of the operator's
 * organization only; everyone else sees why they cannot.
 */
export function FieldGlossaryEditor() {
  const t = useTranslations('settings.fieldGlossary');
  const { organization } = useOrganization();
  const organizationId = organization?.id ?? '';
  const [fieldKey, setFieldKey] = useState<string>(FIELDS[0].key);
  const list = trpc.fieldGlossary.listForEditor.useQuery(
    { organizationId },
    { enabled: !!organizationId, retry: false }
  );

  if (!organizationId || list.isLoading) return <Spinner />;
  if (list.error?.data?.code === 'FORBIDDEN') {
    return (
      <Callout title={t('forbiddenTitle')} icon={Lock} color="yellow">
        {t('forbiddenBody')}
      </Callout>
    );
  }
  if (list.isError || !list.data) return <LoadError onRetry={() => list.refetch()} />;

  const field = FIELDS.find((f) => f.key === fieldKey) ?? FIELDS[0];
  const entries = list.data.entries.filter((entry) => entry.fieldKey === field.key);

  return (
    <div className="space-y-6">
      <FieldPicker fieldKey={field.key} onChange={setFieldKey} entries={list.data.entries} />
      <EntryCard
        key={`${field.key}:`}
        organizationId={organizationId}
        field={field}
        value={null}
        entry={entries.find((entry) => entry.value === null) ?? null}
      />
      {field.values?.map((value) => (
        <EntryCard
          key={`${field.key}:${value}`}
          organizationId={organizationId}
          field={field}
          value={value}
          entry={entries.find((entry) => entry.value === value) ?? null}
        />
      ))}
    </div>
  );
}

function FieldPicker({
  fieldKey,
  onChange,
  entries,
}: {
  fieldKey: string;
  onChange: (key: string) => void;
  entries: Entry[];
}) {
  const t = useTranslations('settings.fieldGlossary');
  const tFields = useTranslations('fieldGlossary.fields');
  const id = useId();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('pickTitle')}</CardTitle>
        <CardDescription>{t('pickDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <Label htmlFor={id}>{t('field')}</Label>
        <Select value={fieldKey} onValueChange={onChange}>
          <SelectTrigger id={id} className="w-full md:w-96">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FIELDS.map((field) => {
              const written = entries.filter((entry) => entry.fieldKey === field.key).length;
              const total = 1 + (field.values?.length ?? 0);
              return (
                <SelectItem key={field.key} value={field.key}>
                  {t('fieldOption', { name: tFields(field.id), written, total })}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </CardContent>
    </Card>
  );
}

function EntryCard({
  organizationId,
  field,
  value,
  entry,
}: {
  organizationId: string;
  field: GlossaryField;
  value: string | null;
  entry: Entry | null;
}) {
  const t = useTranslations('settings.fieldGlossary');
  const tFields = useTranslations('fieldGlossary.fields');
  const tRoot = useTranslations();
  const utils = trpc.useUtils();
  const jaId = useId();
  const enId = useId();
  const [descriptionJa, setDescriptionJa] = useState(entry?.descriptionJa ?? '');
  const [descriptionEn, setDescriptionEn] = useState(entry?.descriptionEn ?? '');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const refresh = () => {
    utils.fieldGlossary.listForEditor.invalidate();
    // The popovers cache the dictionary; show the change on this browser's screens right away
    utils.fieldGlossary.getByKeys.invalidate();
  };
  const upsert = trpc.fieldGlossary.upsert.useMutation({
    onSuccess: () => {
      refresh();
      toast.success(t('saved'));
    },
    onError: () => toast.error(t('saveError')),
  });
  const remove = trpc.fieldGlossary.delete.useMutation({
    onSuccess: () => {
      setDescriptionJa('');
      setDescriptionEn('');
      setConfirmDelete(false);
      refresh();
      toast.success(t('deleted'));
    },
    onError: () => toast.error(t('deleteError')),
  });

  const title =
    value === null
      ? t('fieldEntryTitle', { name: tFields(field.id) })
      : field.valueLabels
        ? tRoot(`${field.valueLabels}.${value}`)
        : value;
  const dirty =
    descriptionJa.trim() !== (entry?.descriptionJa ?? '') ||
    descriptionEn.trim() !== (entry?.descriptionEn ?? '');
  const busy = upsert.isPending || remove.isPending;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-base">{title}</CardTitle>
          {value !== null && <code className="text-xs text-muted-foreground">{value}</code>}
          <Badge variant={entry ? 'secondary' : 'outline'}>
            {entry ? t('written') : t('notWritten')}
          </Badge>
        </div>
        {value === null && <CardDescription>{t('fieldEntryDescription')}</CardDescription>}
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            upsert.mutate({
              organizationId,
              fieldKey: field.key,
              value,
              descriptionJa,
              descriptionEn: descriptionEn.trim() === '' ? null : descriptionEn,
            });
          }}
        >
          <div className="space-y-2">
            <Label htmlFor={jaId}>{t('descriptionJa')}</Label>
            <Textarea
              id={jaId}
              value={descriptionJa}
              onChange={(event) => setDescriptionJa(event.target.value)}
              maxLength={FIELD_GLOSSARY_DESCRIPTION_MAX}
              rows={3}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={enId}>{t('descriptionEn')}</Label>
            <Textarea
              id={enId}
              value={descriptionEn}
              onChange={(event) => setDescriptionEn(event.target.value)}
              maxLength={FIELD_GLOSSARY_DESCRIPTION_MAX}
              rows={2}
            />
            <p className="text-xs text-muted-foreground">{t('descriptionEnHint')}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy || !dirty || descriptionJa.trim() === ''}>
              {upsert.isPending ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-1 h-4 w-4" />
              )}
              {t('save')}
            </Button>
            {entry && (
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 className="mr-1 h-4 w-4" />
                {t('delete')}
              </Button>
            )}
          </div>
        </form>
      </CardContent>
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteTitle', { name: title })}</AlertDialogTitle>
            <AlertDialogDescription>{t('deleteBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                if (entry) remove.mutate({ organizationId, id: entry.id });
              }}
            >
              {t('delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function Spinner() {
  return (
    <div className="flex items-center justify-center py-12">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}

function LoadError({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations('settings.fieldGlossary');
  return (
    <Callout title={t('loadErrorTitle')} icon={AlertTriangle} color="red">
      <p>{t('loadErrorBody')}</p>
      <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
        <RefreshCw className="mr-1 h-4 w-4" />
        {t('retry')}
      </Button>
    </Callout>
  );
}
