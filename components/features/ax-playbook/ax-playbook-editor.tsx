'use client';

import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useOrganization } from '@/hooks/use-organization';
import {
  type AxPlaybookForm,
  fromAxPlaybookForm,
  toAxPlaybookForm,
} from '@/lib/features/ax-playbook/form';
import {
  AX_PLAYBOOK_CHALLENGES,
  AX_PLAYBOOK_LIMITS,
  OBJECTION_REASONS,
  type ObjectionReason,
  axPlaybookContentSchema,
  emptyAxPlaybookContent,
} from '@/lib/features/ax-playbook/types/schemas';
import { trpc } from '@/lib/trpc/client';
import { AlertTriangle, Loader2, Lock, Plus, RefreshCw, Save, Trash2 } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { TargetCompanyCard } from './target-company-card';

type RowListKey = 'objections' | 'ngPhrases' | 'escalations';

const ROW_FIELDS = {
  objections: ['customer', 'response', 'note'],
  ngPhrases: ['ng', 'alternative'],
  escalations: ['topic', 'contact'],
} as const;

/** Lists whose rows are tagged with the reasons a past attempt stopped (#157) */
const TAGGED_LISTS = ['objections', 'ngPhrases'] as const;
const isTagged = (list: RowListKey): list is (typeof TAGGED_LISTS)[number] =>
  (TAGGED_LISTS as readonly string[]).includes(list);

const EMPTY_ROWS = {
  objections: () => ({ customer: '', response: '', note: '', reasons: [] as ObjectionReason[] }),
  ngPhrases: () => ({ ng: '', alternative: '', reasons: [] as ObjectionReason[] }),
  escalations: () => ({ topic: '', contact: '' }),
} as const;

export function AxPlaybookEditor() {
  const t = useTranslations('settings.axPlaybook');
  const tReason = useTranslations('leadHearings.options.pastBlocker');
  const format = useFormatter();
  const { organization } = useOrganization();
  const organizationId = organization?.id ?? '';
  const [form, setForm] = useState<AxPlaybookForm | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  const utils = trpc.useUtils();
  const { data, isLoading, isError, refetch } = trpc.axPlaybook.get.useQuery(
    { organizationId },
    { enabled: !!organizationId }
  );

  // Fill the form once per organization; a later refetch must not wipe unsaved edits
  useEffect(() => {
    if (data && loadedFor !== organizationId) {
      setForm(toAxPlaybookForm(data.content ?? emptyAxPlaybookContent()));
      setLoadedFor(organizationId);
    }
  }, [data, organizationId, loadedFor]);

  const save = trpc.axPlaybook.update.useMutation({
    onSuccess: (_result, variables) => {
      // Show what was stored (trimmed text, blank rows dropped)
      setForm(toAxPlaybookForm(axPlaybookContentSchema.parse(variables.content)));
      utils.axPlaybook.get.invalidate();
      toast.success(t('saved'));
    },
    onError: () => {
      toast.error(t('saveError'));
    },
  });

  if (isError) {
    return (
      <Callout title={t('loadErrorTitle')} icon={AlertTriangle} color="red">
        <p>{t('loadErrorBody')}</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => refetch()}>
          <RefreshCw className="mr-1 h-4 w-4" />
          {t('retry')}
        </Button>
      </Callout>
    );
  }

  // Until the form holds this organization's playbook, never render (or save) another one's
  if (isLoading || !form || !data || loadedFor !== organizationId) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const readOnly = !data.canEdit;

  const handleSave = () => {
    const parsed = axPlaybookContentSchema.safeParse(fromAxPlaybookForm(form));
    if (!parsed.success) {
      toast.error(
        t('invalid', { textMax: AX_PLAYBOOK_LIMITS.textMax, itemsMax: AX_PLAYBOOK_LIMITS.itemsMax })
      );
      return;
    }
    save.mutate({ organizationId, content: parsed.data });
  };

  const updateRow = (list: RowListKey, index: number, field: string, value: string) => {
    setForm({
      ...form,
      [list]: form[list].map((row, i) => (i === index ? { ...row, [field]: value } : row)),
    });
  };

  const toggleReason = (
    list: (typeof TAGGED_LISTS)[number],
    index: number,
    reason: ObjectionReason,
    on: boolean
  ) => {
    setForm({
      ...form,
      [list]: form[list].map((row, i) =>
        i === index
          ? {
              ...row,
              reasons: on ? [...row.reasons, reason] : row.reasons.filter((r) => r !== reason),
            }
          : row
      ),
    });
  };

  const addRow = (list: RowListKey) => {
    setForm({ ...form, [list]: [...form[list], EMPTY_ROWS[list]()] });
  };

  const removeRow = (list: RowListKey, index: number) => {
    setForm({ ...form, [list]: form[list].filter((_, i) => i !== index) });
  };

  const renderRows = (list: RowListKey) => (
    <Card>
      <CardHeader>
        <CardTitle>{t(`${list}.title`)}</CardTitle>
        <CardDescription>{t(`${list}.description`)}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {form[list].length === 0 && <p className="text-sm text-muted-foreground">{t('noRows')}</p>}
        {form[list].map((row, index) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: rows have no id and are edited in place
            key={index}
            className="space-y-2 rounded-md border p-3"
          >
            {ROW_FIELDS[list].map((field) => {
              const id = `${list}-${index}-${field}`;
              return (
                <div key={field} className="space-y-1">
                  <Label htmlFor={id}>{t(`${list}.${field}`)}</Label>
                  <Textarea
                    id={id}
                    rows={2}
                    value={(row as Record<string, string>)[field]}
                    readOnly={readOnly}
                    maxLength={AX_PLAYBOOK_LIMITS.textMax}
                    onChange={(e) => updateRow(list, index, field, e.target.value)}
                  />
                </div>
              );
            })}
            {isTagged(list) && (
              <fieldset className="space-y-1">
                <legend className="text-sm font-medium">{t(`${list}.reasons`)}</legend>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {OBJECTION_REASONS.map((reason) => {
                    const id = `${list}-${index}-reason-${reason}`;
                    const reasons = (row as { reasons: ObjectionReason[] }).reasons;
                    return (
                      <label
                        key={reason}
                        htmlFor={id}
                        className="flex min-h-9 items-center gap-1.5 text-sm"
                      >
                        <input
                          id={id}
                          type="checkbox"
                          className="h-4 w-4"
                          checked={reasons.includes(reason)}
                          disabled={readOnly}
                          onChange={(e) => toggleReason(list, index, reason, e.target.checked)}
                        />
                        {tReason(reason)}
                      </label>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground">{t(`${list}.reasonsHint`)}</p>
              </fieldset>
            )}
            {!readOnly && (
              <div className="flex justify-end">
                <Button variant="ghost" size="sm" onClick={() => removeRow(list, index)}>
                  <Trash2 className="mr-1 h-4 w-4" />
                  {t('removeRow')}
                </Button>
              </div>
            )}
          </div>
        ))}
        {!readOnly && form[list].length < AX_PLAYBOOK_LIMITS.itemsMax && (
          <Button variant="outline" size="sm" onClick={() => addRow(list)}>
            <Plus className="mr-1 h-4 w-4" />
            {t('addRow')}
          </Button>
        )}
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-6">
      <Callout title={t('confidentialTitle')} icon={Lock} color="yellow">
        {t('confidentialBody')}
      </Callout>
      {data.storedInvalid && (
        <Callout title={t('storedInvalidTitle')} icon={AlertTriangle} color="red">
          {t('storedInvalidBody')}
        </Callout>
      )}
      {readOnly && (
        <Callout title={t('readOnlyTitle')} color="blue">
          {t('readOnlyBody')}
        </Callout>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t('challenges.title')}</CardTitle>
          <CardDescription>{t('challenges.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="people">
            <TabsList>
              {AX_PLAYBOOK_CHALLENGES.map((key) => (
                <TabsTrigger key={key} value={key}>
                  {t(`challenges.${key}`)}
                </TabsTrigger>
              ))}
            </TabsList>
            {AX_PLAYBOOK_CHALLENGES.map((key) => (
              <TabsContent key={key} value={key} className="space-y-4 pt-4">
                {(['effect', 'questions', 'signals'] as const).map((field) => {
                  const id = `challenge-${key}-${field}`;
                  return (
                    <div key={field} className="space-y-1">
                      <Label htmlFor={id}>{t(`challenges.${field}`)}</Label>
                      <Textarea
                        id={id}
                        rows={field === 'effect' ? 3 : 5}
                        maxLength={field === 'effect' ? AX_PLAYBOOK_LIMITS.textMax : undefined}
                        value={form.challenges[key][field]}
                        readOnly={readOnly}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            challenges: {
                              ...form.challenges,
                              [key]: { ...form.challenges[key], [field]: e.target.value },
                            },
                          })
                        }
                      />
                      {field !== 'effect' && (
                        <p className="text-xs text-muted-foreground">{t('onePerLine')}</p>
                      )}
                    </div>
                  );
                })}
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('basicChecks.title')}</CardTitle>
          <CardDescription>{t('basicChecks.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-1">
          <Textarea
            aria-label={t('basicChecks.title')}
            rows={5}
            value={form.basicChecks}
            readOnly={readOnly}
            onChange={(e) => setForm({ ...form, basicChecks: e.target.value })}
          />
          <p className="text-xs text-muted-foreground">{t('onePerLine')}</p>
        </CardContent>
      </Card>

      <TargetCompanyCard
        key={organizationId}
        organizationId={organizationId}
        initial={(data.content ?? emptyAxPlaybookContent()).targetCompany}
        canEdit={data.canEditTargetCompany}
      />

      {renderRows('objections')}
      {renderRows('ngPhrases')}
      {renderRows('escalations')}

      <Card>
        <CardHeader>
          <CardTitle>{t('scheduleFollowUp.title')}</CardTitle>
          <CardDescription>{t('scheduleFollowUp.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-1">
          <Textarea
            aria-label={t('scheduleFollowUp.title')}
            rows={4}
            maxLength={AX_PLAYBOOK_LIMITS.textMax}
            placeholder={t('scheduleFollowUp.placeholder')}
            value={form.scheduleFollowUp}
            readOnly={readOnly}
            onChange={(e) => setForm({ ...form, scheduleFollowUp: e.target.value })}
          />
          <p className="text-xs text-muted-foreground">{t('scheduleFollowUp.hint')}</p>
        </CardContent>
      </Card>

      {!readOnly && (
        <div className="flex items-center justify-end gap-3">
          {data.updatedAt && (
            <span className="text-sm text-muted-foreground">
              {t('lastUpdated', {
                date: format.dateTime(new Date(data.updatedAt), {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                }),
              })}
            </span>
          )}
          <Button onClick={handleSave} disabled={save.isPending}>
            {save.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            {t('save')}
          </Button>
        </div>
      )}
    </div>
  );
}
