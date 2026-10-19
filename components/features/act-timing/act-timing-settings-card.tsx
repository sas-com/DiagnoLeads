'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { actTimingSettingsSchema } from '@/lib/features/act-timing/types/schemas';
import { trpc } from '@/lib/trpc/client';
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useState } from 'react';
import { toast } from 'sonner';

/**
 * Organization settings of "when to act" (Refs #151): the months a migration takes and how many
 * months before the assignee is told. Saving recomputes the organization's leads.
 */
export function ActTimingSettingsCard({ organizationId }: { organizationId: string }) {
  const t = useTranslations('actTiming.settings');
  const id = useId();
  const query = trpc.actTiming.settings.useQuery({ organizationId }, { retry: false });
  const [form, setForm] = useState({ migrationMonths: '', noticeMonths: '' });
  const save = trpc.actTiming.updateSettings.useMutation({
    onSuccess: (result) => toast.success(t('saved', { count: result.recomputed })),
    onError: () => toast.error(t('saveError')),
  });

  useEffect(() => {
    if (query.data) {
      setForm({
        migrationMonths: String(query.data.settings.migrationMonths),
        noticeMonths: String(query.data.settings.noticeMonths),
      });
    }
  }, [query.data]);

  if (query.isError) return null;
  const canEdit = !!query.data?.canEdit;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = actTimingSettingsSchema.safeParse({
      migrationMonths: Number(form.migrationMonths),
      noticeMonths: Number(form.noticeMonths),
    });
    if (!parsed.success) {
      toast.error(t('invalid'));
      return;
    }
    save.mutate({ organizationId, settings: parsed.data });
  };

  return (
    <Card id="act-timing">
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent>
        {!query.data ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden="true" />
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor={`${id}-migration`}>{t('migrationMonths')}</Label>
                <Input
                  id={`${id}-migration`}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={60}
                  value={form.migrationMonths}
                  disabled={!canEdit}
                  onChange={(event) => setForm({ ...form, migrationMonths: event.target.value })}
                />
                <p className="text-xs text-muted-foreground">{t('migrationMonthsHint')}</p>
              </div>
              <div className="space-y-1">
                <Label htmlFor={`${id}-notice`}>{t('noticeMonths')}</Label>
                <Input
                  id={`${id}-notice`}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={12}
                  value={form.noticeMonths}
                  disabled={!canEdit}
                  onChange={(event) => setForm({ ...form, noticeMonths: event.target.value })}
                />
                <p className="text-xs text-muted-foreground">{t('noticeMonthsHint')}</p>
              </div>
            </div>
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
