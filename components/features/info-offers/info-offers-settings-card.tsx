'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  INFO_OFFER_LIMITS,
  type InfoDocument,
  type InfoOffersSettings,
  type InfoSeminar,
  infoOffersSettingsSchema,
} from '@/lib/features/info-offers/types/schemas';
import { trpc } from '@/lib/trpc/client';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useState } from 'react';
import { toast } from 'sonner';

const newId = () => crypto.randomUUID();

/**
 * Documents and seminars offered on the AX diagnosis result (Refs #153). Owners and admins edit
 * them; the switch keeps them hidden until the contents are ready.
 */
export function InfoOffersSettingsCard({ organizationId }: { organizationId: string }) {
  const t = useTranslations('infoOffers.settings');
  const id = useId();
  const utils = trpc.useUtils();
  const query = trpc.infoOffers.settings.useQuery({ organizationId }, { retry: false });
  const [form, setForm] = useState<InfoOffersSettings | null>(null);
  const save = trpc.infoOffers.updateSettings.useMutation({
    onSuccess: () => {
      utils.infoOffers.settings.invalidate({ organizationId });
      toast.success(t('saved'));
    },
    onError: () => toast.error(t('saveError')),
  });

  useEffect(() => {
    if (query.data) setForm(query.data.settings);
  }, [query.data]);

  if (query.isError) return null;
  const canEdit = !!query.data?.canEdit;

  const setDocument = (index: number, patch: Partial<InfoDocument>) =>
    form &&
    setForm({
      ...form,
      documents: form.documents.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    });
  const setSeminar = (index: number, patch: Partial<InfoSeminar>) =>
    form &&
    setForm({
      ...form,
      seminars: form.seminars.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = infoOffersSettingsSchema.safeParse(form);
    if (!parsed.success) {
      toast.error(t('saveError'));
      return;
    }
    save.mutate({ organizationId, settings: parsed.data });
  };

  const field = (key: string, label: string, input: React.ReactNode, className = '') => (
    <div className={`space-y-1 ${className}`}>
      <Label htmlFor={`${id}-${key}`} className="text-xs">
        {label}
      </Label>
      {input}
    </div>
  );

  return (
    <Card id="info-offers">
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent>
        {!form ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden="true" />
        ) : (
          <form onSubmit={submit} className="space-y-6">
            <div className="flex items-center gap-2">
              <Checkbox
                id={`${id}-enabled`}
                checked={form.enabled}
                disabled={!canEdit}
                onCheckedChange={(value) => setForm({ ...form, enabled: value === true })}
              />
              <Label htmlFor={`${id}-enabled`}>{t('enabled')}</Label>
            </div>

            <fieldset className="space-y-3" disabled={!canEdit}>
              <legend className="text-sm font-semibold">{t('documents')}</legend>
              {form.documents.map((item, index) => (
                <div key={item.id} className="grid gap-2 rounded-md border p-3 sm:grid-cols-2">
                  {field(
                    `doc-title-${item.id}`,
                    t('docTitle'),
                    <Input
                      id={`${id}-doc-title-${item.id}`}
                      maxLength={INFO_OFFER_LIMITS.title}
                      value={item.title}
                      onChange={(event) => setDocument(index, { title: event.target.value })}
                    />
                  )}
                  {field(
                    `doc-url-${item.id}`,
                    t('docUrl'),
                    <Input
                      id={`${id}-doc-url-${item.id}`}
                      type="url"
                      maxLength={INFO_OFFER_LIMITS.url}
                      value={item.url}
                      onChange={(event) => setDocument(index, { url: event.target.value })}
                    />
                  )}
                  {field(
                    `doc-description-${item.id}`,
                    t('docDescription'),
                    <Input
                      id={`${id}-doc-description-${item.id}`}
                      maxLength={INFO_OFFER_LIMITS.description}
                      value={item.description}
                      onChange={(event) => setDocument(index, { description: event.target.value })}
                    />,
                    'sm:col-span-2'
                  )}
                  <div className="sm:col-span-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setForm({
                          ...form,
                          documents: form.documents.filter((_, i) => i !== index),
                        })
                      }
                    >
                      <Trash2 className="mr-1 h-4 w-4" aria-hidden="true" />
                      {t('remove')}
                    </Button>
                  </div>
                </div>
              ))}
              {canEdit && form.documents.length < INFO_OFFER_LIMITS.items && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setForm({
                      ...form,
                      documents: [
                        ...form.documents,
                        { id: newId(), title: '', description: '', url: '' },
                      ],
                    })
                  }
                >
                  <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
                  {t('addDocument')}
                </Button>
              )}
            </fieldset>

            <fieldset className="space-y-3" disabled={!canEdit}>
              <legend className="text-sm font-semibold">{t('seminars')}</legend>
              {form.seminars.map((item, index) => {
                const counts = query.data?.seminarCounts[item.id];
                return (
                  <div key={item.id} className="grid gap-2 rounded-md border p-3 sm:grid-cols-2">
                    {field(
                      `sem-title-${item.id}`,
                      t('semTitle'),
                      <Input
                        id={`${id}-sem-title-${item.id}`}
                        maxLength={INFO_OFFER_LIMITS.title}
                        value={item.title}
                        onChange={(event) => setSeminar(index, { title: event.target.value })}
                      />
                    )}
                    {field(
                      `sem-date-${item.id}`,
                      t('semDate'),
                      <Input
                        id={`${id}-sem-date-${item.id}`}
                        type="date"
                        value={item.date}
                        onChange={(event) => setSeminar(index, { date: event.target.value })}
                      />
                    )}
                    {field(
                      `sem-time-${item.id}`,
                      t('semTime'),
                      <Input
                        id={`${id}-sem-time-${item.id}`}
                        maxLength={INFO_OFFER_LIMITS.time}
                        value={item.time}
                        onChange={(event) => setSeminar(index, { time: event.target.value })}
                      />
                    )}
                    {field(
                      `sem-format-${item.id}`,
                      t('semFormat'),
                      <Input
                        id={`${id}-sem-format-${item.id}`}
                        maxLength={INFO_OFFER_LIMITS.format}
                        value={item.format}
                        onChange={(event) => setSeminar(index, { format: event.target.value })}
                      />
                    )}
                    {field(
                      `sem-description-${item.id}`,
                      t('semDescription'),
                      <Input
                        id={`${id}-sem-description-${item.id}`}
                        maxLength={INFO_OFFER_LIMITS.description}
                        value={item.description}
                        onChange={(event) => setSeminar(index, { description: event.target.value })}
                      />,
                      'sm:col-span-2'
                    )}
                    <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
                      {counts && (
                        <span className="text-xs text-muted-foreground">{t('counts', counts)}</span>
                      )}
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          setForm({
                            ...form,
                            seminars: form.seminars.filter((_, i) => i !== index),
                          })
                        }
                      >
                        <Trash2 className="mr-1 h-4 w-4" aria-hidden="true" />
                        {t('remove')}
                      </Button>
                    </div>
                  </div>
                );
              })}
              {canEdit && form.seminars.length < INFO_OFFER_LIMITS.items && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setForm({
                      ...form,
                      seminars: [
                        ...form.seminars,
                        { id: newId(), title: '', description: '', date: '', time: '', format: '' },
                      ],
                    })
                  }
                >
                  <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
                  {t('addSeminar')}
                </Button>
              )}
              <p className="text-xs text-muted-foreground">
                {t('limit', { max: INFO_OFFER_LIMITS.items })}
              </p>
            </fieldset>

            {canEdit ? (
              <Button type="submit" disabled={save.isPending}>
                {save.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                {t('save')}
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground">{t('readOnly')}</p>
            )}
          </form>
        )}
      </CardContent>
    </Card>
  );
}
