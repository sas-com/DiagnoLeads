'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { RouterOutputs } from '@/lib/trpc/client';
import { trpc } from '@/lib/trpc/client';
import { BookText, Edit, Loader2, Lock, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

type FieldGlossaryEntry = RouterOutputs['fieldGlossary']['list']['entries'][number];

/**
 * A field key is '<feature>.<field>', e.g. 'leads.status'
 * (lib/features/field-glossary/types/schemas.ts). Checked here too so an invalid key is caught
 * before the save, not shown to the editor as a raw validation error.
 */
const FIELD_KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+)+$/;

const isFieldKeyValid = (fieldKey: string) => FIELD_KEY_PATTERN.test(fieldKey.trim());

interface FieldGlossaryFormData {
  fieldKey: string;
  /** Blank for the field-level entry (the field's own help); set for help on one value of the field */
  value: string;
  labelJa: string;
  labelEn: string;
  descriptionJa: string;
  descriptionEn: string;
  /** Kept as text so the input can be cleared; parsed to a number on submit */
  sortOrder: string;
}

const EMPTY_FORM: FieldGlossaryFormData = {
  fieldKey: '',
  value: '',
  labelJa: '',
  labelEn: '',
  descriptionJa: '',
  descriptionEn: '',
  sortOrder: '0',
};

/** Group the entries by field key, keeping the order the list came in (field-level entry first) */
function groupByFieldKey(entries: FieldGlossaryEntry[]): [string, FieldGlossaryEntry[]][] {
  const groups = new Map<string, FieldGlossaryEntry[]>();
  for (const entry of entries) {
    const group = groups.get(entry.fieldKey);
    if (group) group.push(entry);
    else groups.set(entry.fieldKey, [entry]);
  }
  return [...groups];
}

/** fieldKey, value, labels, descriptions and sort order: shared by the create and edit dialogs */
function FieldGlossaryFormFields({
  form,
  onChange,
}: {
  form: FieldGlossaryFormData;
  onChange: (update: (prev: FieldGlossaryFormData) => FieldGlossaryFormData) => void;
}) {
  const t = useTranslations('settings.fieldGlossary');
  const fieldKeyInvalid = form.fieldKey.trim() !== '' && !isFieldKeyValid(form.fieldKey);

  return (
    <div className="grid gap-4 py-4">
      <div className="grid gap-2">
        <Label htmlFor="fieldKey">{t('fieldKey')}</Label>
        <Input
          id="fieldKey"
          value={form.fieldKey}
          onChange={(e) => onChange((prev) => ({ ...prev, fieldKey: e.target.value }))}
          placeholder={t('fieldKeyPlaceholder')}
        />
        {fieldKeyInvalid && <p className="text-xs text-destructive">{t('fieldKeyInvalid')}</p>}
      </div>

      <div className="grid gap-2">
        <Label htmlFor="value">{t('value')}</Label>
        <Input
          id="value"
          value={form.value}
          onChange={(e) => onChange((prev) => ({ ...prev, value: e.target.value }))}
        />
        <p className="text-xs text-muted-foreground">{t('valueHint')}</p>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="labelJa">{t('labelJa')}</Label>
        <Input
          id="labelJa"
          value={form.labelJa}
          onChange={(e) => onChange((prev) => ({ ...prev, labelJa: e.target.value }))}
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="labelEn">{t('labelEn')}</Label>
        <Input
          id="labelEn"
          value={form.labelEn}
          onChange={(e) => onChange((prev) => ({ ...prev, labelEn: e.target.value }))}
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="descriptionJa">{t('descriptionJa')}</Label>
        <Textarea
          id="descriptionJa"
          value={form.descriptionJa}
          onChange={(e) => onChange((prev) => ({ ...prev, descriptionJa: e.target.value }))}
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="descriptionEn">{t('descriptionEn')}</Label>
        <Textarea
          id="descriptionEn"
          value={form.descriptionEn}
          onChange={(e) => onChange((prev) => ({ ...prev, descriptionEn: e.target.value }))}
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="sortOrder">{t('sortOrder')}</Label>
        <Input
          id="sortOrder"
          type="number"
          value={form.sortOrder}
          onChange={(e) => onChange((prev) => ({ ...prev, sortOrder: e.target.value }))}
        />
      </div>
    </div>
  );
}

/**
 * Edit page for the site-wide field glossary (Epic #780 P0b, #800). Only an owner/admin of the
 * operator organization may open it: the list query answers everyone else with FORBIDDEN and the
 * page then shows a no-permission card. The glossary is site-wide, so no organizationId is sent.
 */
export default function FieldGlossarySettingsPage() {
  const t = useTranslations('settings.fieldGlossary');
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [createForm, setCreateForm] = useState<FieldGlossaryFormData>(EMPTY_FORM);
  const [editForm, setEditForm] = useState<FieldGlossaryFormData>(EMPTY_FORM);

  const utils = trpc.useUtils();
  const { data, isLoading, error } = trpc.fieldGlossary.list.useQuery();

  const upsertEntry = trpc.fieldGlossary.upsert.useMutation({
    onSuccess: (_entry, variables) => {
      utils.fieldGlossary.list.invalidate();
      setIsCreateOpen(false);
      setEditingId(null);
      toast.success(variables.id ? t('updated') : t('created'));
    },
    onError: (error) => {
      toast.error(error.data?.code === 'CONFLICT' ? t('conflict') : error.message);
    },
  });

  const deleteEntry = trpc.fieldGlossary.delete.useMutation({
    onSuccess: () => {
      utils.fieldGlossary.list.invalidate();
      toast.success(t('deleted'));
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  /** fieldKey, value (null when blank = the field-level entry) and the rest, as upsert expects */
  const toUpsertInput = (form: FieldGlossaryFormData) => {
    const sortOrder = Number.parseInt(form.sortOrder, 10);
    return {
      fieldKey: form.fieldKey.trim(),
      value: form.value.trim() === '' ? null : form.value.trim(),
      labelJa: form.labelJa,
      labelEn: form.labelEn,
      descriptionJa: form.descriptionJa,
      descriptionEn: form.descriptionEn,
      sortOrder: Number.isFinite(sortOrder) ? sortOrder : 0,
    };
  };

  const handleCreate = () => {
    upsertEntry.mutate(toUpsertInput(createForm));
  };

  const handleStartEdit = (entry: FieldGlossaryEntry) => {
    setEditForm({
      fieldKey: entry.fieldKey,
      value: entry.value ?? '',
      labelJa: entry.labelJa ?? '',
      labelEn: entry.labelEn ?? '',
      descriptionJa: entry.descriptionJa ?? '',
      descriptionEn: entry.descriptionEn ?? '',
      sortOrder: String(entry.sortOrder),
    });
    setEditingId(entry.id);
  };

  const handleUpdate = () => {
    if (!editingId) return;
    upsertEntry.mutate({ id: editingId, ...toUpsertInput(editForm) });
  };

  const handleDelete = (id: string) => {
    if (!confirm(t('confirmDelete'))) return;
    deleteEntry.mutate({ id });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error?.data?.code === 'FORBIDDEN') {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-muted-foreground">{t('description')}</p>
        </div>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Lock className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">{t('forbidden')}</h3>
            <p className="text-muted-foreground text-center max-w-md">
              {t('forbiddenDescription')}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const groups = groupByFieldKey(data?.entries ?? []);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-muted-foreground">{t('description')}</p>
        </div>
        <Dialog
          open={isCreateOpen}
          onOpenChange={(open) => {
            setIsCreateOpen(open);
            if (open) setCreateForm(EMPTY_FORM);
          }}
        >
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              {t('add')}
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>{t('createTitle')}</DialogTitle>
              <DialogDescription>{t('createDescription')}</DialogDescription>
            </DialogHeader>

            <FieldGlossaryFormFields form={createForm} onChange={setCreateForm} />

            <DialogFooter>
              <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
                {t('cancel')}
              </Button>
              <Button
                onClick={handleCreate}
                disabled={!isFieldKeyValid(createForm.fieldKey) || upsertEntry.isPending}
              >
                {upsertEntry.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t('create')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Edit dialog */}
      <Dialog
        open={editingId !== null}
        onOpenChange={(open) => {
          if (!open) setEditingId(null);
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t('editTitle')}</DialogTitle>
            <DialogDescription>{t('editDescription')}</DialogDescription>
          </DialogHeader>

          <FieldGlossaryFormFields form={editForm} onChange={setEditForm} />

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingId(null)}>
              {t('cancel')}
            </Button>
            <Button
              onClick={handleUpdate}
              disabled={!isFieldKeyValid(editForm.fieldKey) || upsertEntry.isPending}
            >
              {upsertEntry.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Entries grouped by field key */}
      {groups.length > 0 ? (
        <div className="grid gap-4">
          {groups.map(([fieldKey, groupEntries]) => (
            <Card key={fieldKey}>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg font-mono">{fieldKey}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="divide-y">
                  {groupEntries.map((entry) => {
                    const description = entry.descriptionJa ?? entry.descriptionEn;
                    const label = entry.labelJa ?? entry.labelEn;
                    return (
                      <div
                        key={entry.id}
                        className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            {entry.value === null ? (
                              <span className="inline-flex items-center rounded-full bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
                                {t('fieldLevel')}
                              </span>
                            ) : (
                              <code className="rounded bg-muted px-2 py-1 text-xs font-mono">
                                {entry.value}
                              </code>
                            )}
                            {label && <span className="text-sm font-medium">{label}</span>}
                          </div>
                          {description && (
                            <p className="text-sm text-muted-foreground">{description}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={t('edit')}
                            onClick={() => handleStartEdit(entry)}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={t('delete')}
                            onClick={() => handleDelete(entry.id)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <BookText className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">{t('noEntries')}</h3>
            <p className="text-muted-foreground text-center mb-4 max-w-md">
              {t('noEntriesDescription')}
            </p>
            <Button
              onClick={() => {
                setCreateForm(EMPTY_FORM);
                setIsCreateOpen(true);
              }}
            >
              <Plus className="mr-2 h-4 w-4" />
              {t('createFirst')}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
