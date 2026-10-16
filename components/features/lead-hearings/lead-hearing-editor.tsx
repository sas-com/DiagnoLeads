'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useOrganization } from '@/hooks/use-organization';
import {
  DEFAULT_HEARING_CATALOG,
  type HearingFieldDefinition,
  type HearingFieldKey,
  type HearingItemStatus,
  type HearingSectionId,
} from '@/lib/features/lead-hearings/catalog';
import {
  changeHearingValue,
  computeFormMissingItems,
  confirmHearingEntry,
  countBySection,
  entryOf,
  hearingHintText,
  setHearingStatus,
  toDiagnosticLocale,
  toSavedHearingFields,
} from '@/lib/features/lead-hearings/form';
import {
  type HearingFieldEntry,
  type HearingFieldValue,
  type HearingFields,
  type HearingPrefillSnapshot,
  ISO_DATE_PATTERN,
  hearingFieldsSchema,
} from '@/lib/features/lead-hearings/types/schemas';
import { trpc } from '@/lib/trpc/client';
import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  Loader2,
  RefreshCw,
  Save,
  ShieldAlert,
} from 'lucide-react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { HearingFieldRow } from './hearing-field-row';

/** Organization overrides (#98) will resolve their own catalog view */
const catalog = DEFAULT_HEARING_CATALOG;

interface LoadedHearing {
  id: string;
  heldOn: string;
  fields: HearingFields;
  updatedAt: Date | string;
}

interface LeadHearingEditorProps {
  leadId: string;
  hearingId: string;
}

/** Editor of one first-meeting hearing (Refs #84) */
export function LeadHearingEditor({ leadId, hearingId }: LeadHearingEditorProps) {
  const t = useTranslations('leadHearings');
  const tRoot = useTranslations();
  const format = useFormatter();
  const locale = useLocale();
  const diagnosisLocale = toDiagnosticLocale(locale);
  const { organizationId } = useOrganization();
  const orgId = organizationId ?? '';
  const formKey = `${orgId}:${hearingId}`;

  const [form, setForm] = useState<HearingFields | null>(null);
  const [heldOn, setHeldOn] = useState('');
  const [baseUpdatedAt, setBaseUpdatedAt] = useState<Date | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  // Fields whose status the user picked on this screen (a typed value then keeps that status).
  // Only read by the handlers, so a ref: picking a status does not need another render.
  const statusPicked = useRef(new Set<string>());
  const [tab, setTab] = useState<HearingSectionId>(catalog.sections[0].id);
  const [conflict, setConflict] = useState(false);

  const utils = trpc.useUtils();
  const hearing = trpc.leadHearings.get.useQuery(
    { organizationId: orgId, id: hearingId },
    { enabled: !!orgId, retry: false }
  );
  const lead = trpc.leads.get.useQuery(
    { organizationId: orgId, id: leadId },
    { enabled: !!orgId, retry: false }
  );

  const fill = (data: LoadedHearing) => {
    setForm(data.fields);
    setHeldOn(data.heldOn);
    setBaseUpdatedAt(new Date(data.updatedAt));
    statusPicked.current = new Set();
    setConflict(false);
    setLoadedFor(formKey);
  };

  // Fill the form once per hearing; a later refetch must not wipe unsaved edits
  // biome-ignore lint/correctness/useExhaustiveDependencies: fill only sets state
  useEffect(() => {
    if (hearing.data && hearing.data.id === hearingId && loadedFor !== formKey) {
      fill(hearing.data);
    }
  }, [hearing.data, hearingId, formKey, loadedFor]);

  const save = trpc.leadHearings.update.useMutation({
    onSuccess: (saved) => {
      fill(saved);
      // The saved row is the latest; put it in the cache instead of fetching it again
      utils.leadHearings.get.setData({ organizationId: orgId, id: hearingId }, (current) =>
        current ? { ...current, ...saved } : current
      );
      utils.leadHearings.listByLead.invalidate({ organizationId: orgId, leadId });
      toast.success(t('editor.saved'));
    },
    onError: (error) => {
      if (error.data?.code === 'CONFLICT') {
        setConflict(true);
      } else {
        toast.error(t('editor.saveError'));
      }
    },
  });

  const missing = useMemo(() => computeFormMissingItems(form ?? {}, catalog.requiredItems), [form]);
  const missingBySection = useMemo(() => countBySection(missing.missingKeys, catalog), [missing]);

  const prefill = (hearing.data?.prefill ?? null) as HearingPrefillSnapshot | null;
  const hints = useMemo(() => {
    const byKey = new Map<string, string | null>();
    for (const section of catalog.sections) {
      for (const { field } of section.fields) {
        byKey.set(
          field.key,
          hearingHintText(prefill, field.key as HearingFieldKey, diagnosisLocale)
        );
      }
    }
    return byKey;
  }, [prefill, diagnosisLocale]);

  // Stable handlers, so a change re-renders only the row that changed
  const updateEntry = useCallback(
    (key: HearingFieldKey, update: (entry: HearingFieldEntry) => HearingFieldEntry) => {
      setForm((current) =>
        current ? { ...current, [key]: update(entryOf(current, key)) } : current
      );
    },
    []
  );
  const handleValueChange = useCallback(
    (field: HearingFieldDefinition, value: HearingFieldValue | undefined) => {
      const key = field.key as HearingFieldKey;
      updateEntry(key, (entry) =>
        changeHearingValue(field, entry, value, statusPicked.current.has(key))
      );
    },
    [updateEntry]
  );
  const handleStatusChange = useCallback(
    (field: HearingFieldDefinition, status: HearingItemStatus) => {
      statusPicked.current.add(field.key);
      updateEntry(field.key as HearingFieldKey, (entry) => setHearingStatus(entry, status));
    },
    [updateEntry]
  );
  const handleConfirm = useCallback(
    (field: HearingFieldDefinition) =>
      updateEntry(field.key as HearingFieldKey, confirmHearingEntry),
    [updateEntry]
  );

  const errorCode = hearing.error?.data?.code;
  // BAD_REQUEST: the id in the URL is not a valid id
  const notFound =
    errorCode === 'NOT_FOUND' ||
    errorCode === 'BAD_REQUEST' ||
    (hearing.data !== undefined && hearing.data.leadId !== leadId);
  const backHref = `/${locale}/leads?leadId=${leadId}`;

  if (notFound) {
    return (
      <Callout title={t('editor.notFoundTitle')} icon={AlertTriangle} color="yellow">
        <p>{t('editor.notFoundBody')}</p>
        <Button asChild variant="outline" size="sm" className="mt-3">
          <Link href={backHref}>
            <ArrowLeft className="h-4 w-4" />
            {t('editor.back')}
          </Link>
        </Button>
      </Callout>
    );
  }

  if (hearing.isError) {
    return (
      <Callout title={t('editor.loadErrorTitle')} icon={AlertTriangle} color="red">
        <p>{t('editor.loadErrorBody')}</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => hearing.refetch()}>
          <RefreshCw className="h-4 w-4" />
          {t('editor.retry')}
        </Button>
      </Callout>
    );
  }

  // Until the form holds this hearing, never render (or save) another one
  if (!hearing.data || !form || !baseUpdatedAt || loadedFor !== formKey) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const data = hearing.data;
  const readOnly = !data.canEdit;

  const handleSave = () => {
    const parsed = hearingFieldsSchema.safeParse(toSavedHearingFields(form));
    if (!parsed.success || !ISO_DATE_PATTERN.test(heldOn)) {
      toast.error(t('editor.invalid'));
      return;
    }
    setConflict(false);
    save.mutate({
      organizationId: orgId,
      id: hearingId,
      heldOn,
      fields: parsed.data,
      expectedUpdatedAt: baseUpdatedAt,
    });
  };

  const handleReload = async () => {
    const result = await hearing.refetch();
    if (result.data) fill(result.data);
  };

  const sectionOfFirstMissing = (keys: readonly HearingFieldKey[]) => {
    const key = keys.find((k) => missing.missingKeys.includes(k)) ?? keys[0];
    return catalog.sectionOf.get(key) ?? catalog.sections[0].id;
  };

  const requiredItemsCallout = (
    <div className="space-y-3">
      {missing.missing.length > 0 ? (
        <Callout title={t('editor.missingTitle')} icon={AlertTriangle} color="yellow">
          <p>{t('editor.missingBody')}</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {catalog.requiredItems
              .filter((item) => missing.missing.includes(item.id))
              .map((item) => (
                <li key={item.id}>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7"
                    onClick={() => setTab(sectionOfFirstMissing(item.keys))}
                  >
                    {tRoot(item.labelKey)}
                  </Button>
                </li>
              ))}
          </ul>
        </Callout>
      ) : (
        <Callout title={t('editor.allFilled')} color="green" />
      )}
      {missing.unconfirmed.length > 0 && (
        <Callout title={t('editor.unconfirmedTitle')} color="blue">
          <ul className="mt-1 list-disc pl-5">
            {catalog.requiredItems
              .filter((item) => missing.unconfirmed.includes(item.id))
              .map((item) => (
                <li key={item.id}>{tRoot(item.labelKey)}</li>
              ))}
          </ul>
        </Callout>
      )}
    </div>
  );

  return (
    <div className="space-y-6 pb-24">
      {/* Header */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Link href={backHref} className="inline-flex items-center gap-1 text-blue-600">
            <ArrowLeft className="h-4 w-4" />
            {t('editor.back')}
          </Link>
          <Link
            href={`/${locale}/settings/ax-playbook`}
            className="inline-flex items-center gap-1 text-blue-600"
          >
            <BookOpen className="h-4 w-4" />
            {t('editor.playbook')}
          </Link>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
            {lead.data && (
              <p className="text-muted-foreground">
                {[lead.data.name, lead.data.company].filter(Boolean).join(' / ') || lead.data.email}
              </p>
            )}
          </div>
          <div className="space-y-1">
            <Label htmlFor="hearing-held-on">{t('editor.heldOn')}</Label>
            <Input
              id="hearing-held-on"
              type="date"
              className="sm:w-48"
              value={heldOn}
              readOnly={readOnly}
              onChange={(e) => setHeldOn(e.target.value)}
            />
          </div>
        </div>
      </div>

      {readOnly && (
        <Callout title={t('editor.readOnlyTitle')} color="blue">
          {t('editor.readOnlyBody')}
        </Callout>
      )}
      {prefill && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>
            {t('editor.diagnosisFrom', {
              date: format.dateTime(new Date(prefill.submittedAt), { dateStyle: 'medium' }),
            })}
          </span>
          {!prefill.verified && (
            <Badge color="amber">
              <ShieldAlert className="mr-1 h-3 w-3" />
              {t('editor.unverified')}
            </Badge>
          )}
        </div>
      )}
      {prefill && !prefill.verified && (
        <p className="text-sm text-amber-700">{t('editor.unverifiedBody')}</p>
      )}
      {data.droppedKeys.length > 0 && (
        <Callout
          title={t('editor.droppedKeys', { count: data.droppedKeys.length })}
          color="yellow"
        />
      )}
      {conflict && (
        <Callout title={t('editor.conflictTitle')} icon={AlertTriangle} color="red">
          <p>{t('editor.conflictBody')}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={handleReload}>
            <RefreshCw className="h-4 w-4" />
            {t('editor.reload')}
          </Button>
        </Callout>
      )}

      <Tabs value={tab} onValueChange={(value) => setTab(value as HearingSectionId)}>
        <div className="overflow-x-auto">
          <TabsList className="w-max justify-start">
            {catalog.sections.map(({ id: section }) => {
              const count = missingBySection.get(section) ?? 0;
              return (
                <TabsTrigger key={section} value={section} className="gap-1">
                  {t(`sections.${section}`)}
                  {count > 0 && (
                    <Badge color="amber" size="sm" aria-label={t('editor.missingTabs', { count })}>
                      {count}
                    </Badge>
                  )}
                </TabsTrigger>
              );
            })}
          </TabsList>
        </div>

        {catalog.sections.map((section) => (
          <TabsContent key={section.id} value={section.id}>
            <Card>
              <CardContent className="pt-2">
                {section.id === 'outcome' && <div className="pt-4">{requiredItemsCallout}</div>}
                {section.fields.map(({ field, required }) => (
                  <HearingFieldRow
                    key={field.key}
                    field={field}
                    entry={entryOf(form, field.key as HearingFieldKey)}
                    required={required}
                    hint={hints.get(field.key) ?? null}
                    readOnly={readOnly}
                    onValueChange={handleValueChange}
                    onStatusChange={handleStatusChange}
                    onConfirm={handleConfirm}
                  />
                ))}
              </CardContent>
            </Card>
          </TabsContent>
        ))}
      </Tabs>

      {/* Sticky save bar */}
      <div className="sticky bottom-0 z-10 -mx-4 border-t bg-white/95 px-4 py-3 backdrop-blur dark:bg-gray-900/95">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {missing.missing.length > 0 ? (
              <Badge color="amber">
                {t('editor.missingCount', { count: missing.missing.length })}
              </Badge>
            ) : (
              <Badge color="emerald">{t('editor.allFilled')}</Badge>
            )}
            <span className="text-muted-foreground">
              {t('editor.lastUpdated', {
                date: format.dateTime(baseUpdatedAt, {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                }),
              })}
            </span>
          </div>
          {!readOnly && (
            <Button onClick={handleSave} disabled={save.isPending}>
              {save.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {t('editor.save')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
