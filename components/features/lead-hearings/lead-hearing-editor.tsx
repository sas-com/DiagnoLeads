'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useOrganization } from '@/hooks/use-organization';
import { useSession } from '@/lib/auth/client';
import { autosaveStatus } from '@/lib/features/lead-hearings/autosave';
import {
  DEFAULT_HEARING_CATALOG,
  HEARING_BASE_CATALOG,
  HEARING_SECTIONS,
  type HearingFieldDefinition,
  type HearingFieldKey,
  type HearingItemStatus,
  type HearingRequiredItem,
  type HearingSectionId,
  hearingLabel,
  resolveHearingCatalog,
} from '@/lib/features/lead-hearings/catalog';
import {
  type HearingSettings,
  overridesFromSettings,
} from '@/lib/features/lead-hearings/catalog-settings';
import {
  changeHearingOtherNote,
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
  type HearingEditorMode,
  defaultHearingEditorMode,
  hearingModeStorageKey,
  itemHasStatus,
  meetingProgress,
  otherFieldsBySection,
  parseHearingEditorMode,
  requiredItemFields,
  toggleHearingItemStatus,
} from '@/lib/features/lead-hearings/meeting-mode';
import type { HearingSummaryTodo } from '@/lib/features/lead-hearings/summary';
import {
  type HearingFieldEntry,
  type HearingFieldValue,
  type HearingFields,
  type HearingPrefillSnapshot,
  ISO_DATE_PATTERN,
  hearingFieldsSchema,
} from '@/lib/features/lead-hearings/types/schemas';
import { trpc } from '@/lib/trpc/client';
import { cn } from '@/lib/utils';
import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  Loader2,
  RefreshCw,
  Save,
  ShieldAlert,
} from 'lucide-react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { HearingDateInput } from './hearing-date-inputs';
import { HearingFieldRow } from './hearing-field-row';
import { HearingSummaryPanel } from './hearing-summary-panel';
import { useHearingAutosave } from './use-hearing-autosave';

/**
 * The organization's catalog (#98) as the editor uses it. Meeting mode: each required item with
 * its fields, then the other fields per section. Hidden fields this record has a value for still
 * show, so an older record stays readable.
 */
function editorCatalog(settings: HearingSettings | null, stored: HearingFields) {
  const overrides = settings ? overridesFromSettings(settings, stored) : null;
  const catalog = overrides
    ? resolveHearingCatalog(HEARING_BASE_CATALOG, { ...overrides, show: Object.keys(stored) })
    : DEFAULT_HEARING_CATALOG;
  const meetingItems = catalog.requiredItems.map((item) => ({
    item,
    fields: requiredItemFields(catalog, item),
  }));
  const otherSections = otherFieldsBySection(catalog);
  return {
    catalog,
    customFields: overrides?.customFields ?? [],
    meetingItems,
    otherSections,
    otherFieldCount: otherSections.reduce((sum, section) => sum + section.fields.length, 0),
    meetingItemKeys: new Set<string>(
      meetingItems.flatMap(({ fields }) => fields.map(({ field }) => field.key))
    ),
  };
}

/** Frames to wait for a field to appear after a jump from the summary */
const JUMP_MAX_FRAMES = 10;
const JUMP_FOCUS_SELECTOR = ['input:not([type="hidden"])', 'textarea', 'button', 'select']
  .map((control) => `[data-hearing-input] ${control}`)
  .join(', ');

/** The record (the inputs) or the meeting summary (#97) */
export type HearingEditorView = 'record' | 'summary';

/** The mode a user chose last time; storage may be unavailable (private mode, blocked) */
function readStoredMode(key: string): HearingEditorMode | null {
  try {
    return parseHearingEditorMode(window.localStorage.getItem(key));
  } catch {
    return null;
  }
}

function storeMode(key: string, mode: HearingEditorMode) {
  try {
    window.localStorage.setItem(key, mode);
  } catch {
    // Remembering the choice is a convenience only
  }
}

interface LoadedHearing {
  id: string;
  heldOn: string;
  fields: HearingFields;
  updatedAt: Date | string;
}

interface LeadHearingEditorProps {
  leadId: string;
  hearingId: string;
  /** View to open with (the hearings card links straight to the summary) */
  initialView?: HearingEditorView;
}

/** Editor of one first-meeting hearing (Refs #84) */
export function LeadHearingEditor({
  leadId,
  hearingId,
  initialView = 'record',
}: LeadHearingEditorProps) {
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
  const [tab, setTab] = useState<HearingSectionId>(HEARING_SECTIONS[0]);
  const [conflict, setConflict] = useState(false);
  const [othersOpen, setOthersOpen] = useState(false);
  const [view, setView] = useState<HearingEditorView>(initialView);
  // A field to scroll to once the record is shown again (from the summary's to-do list)
  const [jumpTo, setJumpTo] = useState<HearingFieldKey | null>(null);

  // Meeting mode / detail mode: the user's last choice, else by whether the hearing is new
  const session = useSession();
  const modeKey = hearingModeStorageKey(session.data?.user?.id);
  const storedMode = useMemo(() => readStoredMode(modeKey), [modeKey]);
  const [chosenMode, setChosenMode] = useState<HearingEditorMode | null>(null);
  const [defaultMode, setDefaultMode] = useState<HearingEditorMode>('detail');
  const mode = chosenMode ?? storedMode ?? defaultMode;
  const changeMode = (next: HearingEditorMode) => {
    setChosenMode(next);
    storeMode(modeKey, next);
  };

  // What autosave reads when its timer fires (always the latest render)
  const formRef = useRef(form);
  formRef.current = form;
  const heldOnRef = useRef(heldOn);
  heldOnRef.current = heldOn;
  const baseUpdatedAtRef = useRef(baseUpdatedAt);
  baseUpdatedAtRef.current = baseUpdatedAt;

  const utils = trpc.useUtils();
  const hearing = trpc.leadHearings.get.useQuery(
    { organizationId: orgId, id: hearingId },
    { enabled: !!orgId, retry: false }
  );
  const catalogSettings = trpc.leadHearings.catalogSettings.useQuery(
    { organizationId: orgId },
    { enabled: !!orgId, retry: false, staleTime: 60_000 }
  );
  // Fields the record has values for still show; archived options only where chosen (#98)
  const { catalog, customFields, meetingItems, otherSections, otherFieldCount, meetingItemKeys } =
    useMemo(
      () => editorCatalog(catalogSettings.data?.settings ?? null, hearing.data?.fields ?? {}),
      [catalogSettings.data, hearing.data]
    );
  const customFieldsRef = useRef(customFields);
  customFieldsRef.current = customFields;
  const lead = trpc.leads.get.useQuery(
    { organizationId: orgId, id: leadId },
    { enabled: !!orgId, retry: false }
  );

  const fill = (data: LoadedHearing) => {
    if (loadedFor !== formKey) setDefaultMode(defaultHearingEditorMode(data.fields));
    setForm(data.fields);
    setHeldOn(data.heldOn);
    setBaseUpdatedAt(new Date(data.updatedAt));
    baseUpdatedAtRef.current = new Date(data.updatedAt);
    statusPicked.current = new Set();
    setConflict(false);
    setLoadedFor(formKey);
    autosave.reset();
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
      // The next save (maybe queued right now) guards against this row
      const updatedAt = new Date(saved.updatedAt);
      baseUpdatedAtRef.current = updatedAt;
      setBaseUpdatedAt(updatedAt);
      // The saved row is the latest; put it in the cache instead of fetching it again
      utils.leadHearings.get.setData({ organizationId: orgId, id: hearingId }, (current) =>
        current ? { ...current, ...saved } : current
      );
      utils.leadHearings.listByLead.invalidate({ organizationId: orgId, leadId });
      utils.leadHearings.summary.invalidate({ organizationId: orgId, id: hearingId });
      const settled = autosave.saved();
      if (settled.manual) {
        toast.success(t('editor.saved'));
        // Show what was stored, unless that would drop what was typed meanwhile. Autosave
        // never replaces the form: it would trim text while it is being typed.
        if (!settled.editedDuring) {
          setForm(saved.fields);
          setHeldOn(saved.heldOn);
          statusPicked.current = new Set();
        }
      }
    },
    onError: (error) => {
      const isConflict = error.data?.code === 'CONFLICT';
      // A conflict stops autosave; the edits stay on screen until the user reloads
      const { manual } = autosave.failed(isConflict);
      if (isConflict) {
        setConflict(true);
      } else if (manual) {
        toast.error(t('editor.saveError'));
      }
    },
  });

  const loaded = !!hearing.data && !!form && loadedFor === formKey;
  const readOnly = !hearing.data?.canEdit;

  /** Send the current form (the save button, or autosave); false when nothing was sent */
  const startSave = (manual: boolean): boolean => {
    const current = formRef.current;
    const expectedUpdatedAt = baseUpdatedAtRef.current;
    const date = heldOnRef.current;
    if (!current || !expectedUpdatedAt) return false;
    const parsed = hearingFieldsSchema.safeParse(
      toSavedHearingFields(current, customFieldsRef.current)
    );
    if (!parsed.success || !ISO_DATE_PATTERN.test(date)) {
      if (manual) toast.error(t('editor.invalid'));
      return false;
    }
    if (manual) setConflict(false);
    save.mutate({
      organizationId: orgId,
      id: hearingId,
      heldOn: date,
      fields: parsed.data,
      expectedUpdatedAt,
    });
    return true;
  };

  const autosave = useHearingAutosave({ enabled: loaded && !readOnly, start: startSave });
  const { notifyEdit } = autosave;

  const missing = useMemo(
    () => computeFormMissingItems(form ?? {}, catalog.requiredItems, catalog.fieldOf),
    [form, catalog]
  );
  const missingBySection = useMemo(
    () => countBySection(missing.missingKeys, catalog),
    [missing, catalog]
  );
  const missingKeySet = useMemo(() => new Set<string>(missing.missingKeys), [missing]);

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
  }, [prefill, diagnosisLocale, catalog]);

  // Stable handlers, so a change re-renders only the row that changed
  const updateEntry = useCallback(
    (key: HearingFieldKey, update: (entry: HearingFieldEntry) => HearingFieldEntry) => {
      setForm((current) =>
        current ? { ...current, [key]: update(entryOf(current, key)) } : current
      );
      notifyEdit();
    },
    [notifyEdit]
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
  const handleOtherNoteChange = useCallback(
    (field: HearingFieldDefinition, note: string | undefined) =>
      updateEntry(field.key as HearingFieldKey, (entry) => changeHearingOtherNote(entry, note)),
    [updateEntry]
  );
  const handleConfirm = useCallback(
    (field: HearingFieldDefinition) =>
      updateEntry(field.key as HearingFieldKey, confirmHearingEntry),
    [updateEntry]
  );
  const handleItemStatus = useCallback(
    (item: HearingRequiredItem, status: HearingItemStatus) => {
      for (const key of item.keys) statusPicked.current.add(key);
      setForm((current) =>
        current ? toggleHearingItemStatus(current, item, status, catalog.fieldOf) : current
      );
      notifyEdit();
    },
    [notifyEdit, catalog]
  );

  // After a jump from the summary: show the field and put the focus on its input. The record
  // panel mounts a frame after the view changes, so look for the field for a few frames.
  useEffect(() => {
    if (!jumpTo || view !== 'record') return;
    let frame = 0;
    let tries = 0;
    const focusField = () => {
      const row = document.getElementById(`hearing-row-${jumpTo}`);
      if (!row && tries++ < JUMP_MAX_FRAMES) {
        frame = requestAnimationFrame(focusField);
        return;
      }
      if (row) {
        row.scrollIntoView({ block: 'center' });
        // The first control of the input (not the status select above it)
        row.querySelector<HTMLElement>(JUMP_FOCUS_SELECTOR)?.focus({ preventScroll: true });
      }
      setJumpTo(null);
    };
    focusField();
    return () => cancelAnimationFrame(frame);
  }, [jumpTo, view]);

  const errorCode = hearing.error?.data?.code;
  // BAD_REQUEST: the id in the URL is not a valid id
  const notFound =
    errorCode === 'NOT_FOUND' ||
    errorCode === 'BAD_REQUEST' ||
    (hearing.data !== undefined && hearing.data.leadId !== leadId);
  // The lead page's hearings tab (Refs #108)
  const backHref = `/${locale}/leads/${leadId}?tab=hearings`;

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

  // Until the form holds this hearing, never render (or save) another one; the organization's
  // settings first too, so hidden fields do not flash (on error the defaults are used)
  if (!hearing.data || !form || !baseUpdatedAt || !loaded || catalogSettings.isPending) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const data = hearing.data;

  const handleSave = () => autosave.flush(true);
  const changeView = (next: HearingEditorView) => {
    // The summary is built from what is saved: save pending edits first
    if (next === 'summary' && autosave.snapshot.dirty && !readOnly) autosave.flush();
    setView(next);
  };
  /** Show a field (its tab, or the folded fields of the meeting mode) and focus its input */
  const goToField = (key: HearingFieldKey) => {
    if (mode === 'meeting') {
      if (!meetingItemKeys.has(key)) setOthersOpen(true);
    } else {
      setTab(catalog.sectionOf.get(key) ?? catalog.sections[0].id);
    }
    setView('record');
    setJumpTo(key);
  };
  const handleJump = (todo: HearingSummaryTodo) => goToField(todo.key);
  const meetingMode = mode === 'meeting';
  const progress = meetingProgress(missing, catalog.requiredItems);
  const saveStatus = autosaveStatus(autosave.snapshot, autosave.lastSavedAt);
  const saveStatusText = conflict
    ? t('editor.autosave.conflictStopped')
    : saveStatus === 'saving'
      ? t('editor.autosave.saving')
      : saveStatus === 'saved' && autosave.lastSavedAt
        ? t('editor.autosave.saved', {
            time: format.dateTime(autosave.lastSavedAt, { timeStyle: 'short' }),
          })
        : saveStatus === 'unsaved'
          ? t('editor.autosave.unsaved')
          : saveStatus === 'failed'
            ? t('editor.autosave.failed')
            : null;

  const handleReload = async () => {
    const result = await hearing.refetch();
    if (result.data) fill(result.data);
  };

  /** The first field of these keys that is not filled (the first key when all are) */
  const firstMissingOf = (keys: readonly HearingFieldKey[]) =>
    keys.find((k) => missingKeySet.has(k)) ?? keys[0];
  const firstMissingItem = catalog.requiredItems.find((item) => missing.missing.includes(item.id));

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
                    className="h-11 sm:h-9"
                    onClick={() => goToField(firstMissingOf(item.keys))}
                  >
                    {hearingLabel(tRoot, item)}
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
                <li key={item.id}>{hearingLabel(tRoot, item)}</li>
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
            <HearingDateInput
              id="hearing-held-on"
              label={t('editor.heldOn')}
              value={heldOn || undefined}
              readOnly={readOnly}
              clearable={false}
              onChange={(next) => {
                setHeldOn(next ?? '');
                notifyEdit();
              }}
            />
          </div>
        </div>
        {/* The meeting mode and the save bar belong to the record; the summary is read-only */}
        {view === 'record' && (
          <div className="flex flex-wrap items-center gap-3" data-testid="hearing-meeting-toggle">
            <button
              type="button"
              role="switch"
              aria-checked={meetingMode}
              onClick={() => changeMode(meetingMode ? 'detail' : 'meeting')}
              className="inline-flex min-h-11 items-center gap-3 rounded-md px-1 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <span
                aria-hidden="true"
                className={cn(
                  'inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
                  meetingMode ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-700'
                )}
              >
                <span
                  className={cn(
                    'block h-5 w-5 rounded-full bg-white shadow transition-transform',
                    meetingMode ? 'translate-x-5' : 'translate-x-0.5'
                  )}
                />
              </span>
              {t('meeting.toggle')}
            </button>
            <span className="text-xs text-muted-foreground">{t('meeting.toggleHint')}</span>
          </div>
        )}
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

      <Tabs value={view} onValueChange={(value) => changeView(value as HearingEditorView)}>
        <TabsList className="print:hidden">
          <TabsTrigger value="record">{t('editor.viewRecord')}</TabsTrigger>
          <TabsTrigger value="summary">{t('editor.viewSummary')}</TabsTrigger>
        </TabsList>
        <TabsContent value="summary">
          <HearingSummaryPanel
            organizationId={orgId}
            hearingId={hearingId}
            onJump={handleJump}
            pendingChanges={autosave.snapshot.dirty || autosave.snapshot.saving}
          />
        </TabsContent>
        <TabsContent value="record">
          {meetingMode ? (
            <div className="space-y-4" data-testid="hearing-meeting-mode">
              {meetingItems.map(({ item, fields }) => {
                const itemLabel = hearingLabel(tRoot, item);
                const filled = !missing.missing.includes(item.id);
                const quickStatuses = [
                  ['next', t('meeting.next'), t('meeting.nextOf', { item: itemLabel })],
                  [
                    'not_applicable',
                    t('meeting.notApplicable'),
                    t('meeting.notApplicableOf', { item: itemLabel }),
                  ],
                ] as const;
                return (
                  <Card key={item.id} data-testid={`hearing-item-${item.id}`}>
                    <CardContent className="pt-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="flex items-center gap-2 text-base font-semibold">
                          {filled && (
                            <CheckCircle2 className="h-5 w-5 text-emerald-600" aria-hidden="true" />
                          )}
                          {itemLabel}
                        </h2>
                        <div className="ml-auto flex gap-2">
                          {quickStatuses.map(([status, text, label]) => {
                            const active = itemHasStatus(form, item, status);
                            return (
                              <Button
                                key={status}
                                type="button"
                                variant={active ? 'default' : 'outline'}
                                className="min-h-11"
                                aria-pressed={active}
                                aria-label={label}
                                disabled={readOnly}
                                onClick={() => handleItemStatus(item, status)}
                              >
                                {text}
                              </Button>
                            );
                          })}
                        </div>
                      </div>
                      {fields.map(({ field }) => (
                        <HearingFieldRow
                          key={field.key}
                          field={field}
                          entry={entryOf(form, field.key as HearingFieldKey)}
                          required
                          missing={missingKeySet.has(field.key)}
                          hint={hints.get(field.key) ?? null}
                          readOnly={readOnly}
                          variant="chip"
                          onValueChange={handleValueChange}
                          onStatusChange={handleStatusChange}
                          onConfirm={handleConfirm}
                          onOtherNoteChange={handleOtherNoteChange}
                        />
                      ))}
                    </CardContent>
                  </Card>
                );
              })}

              <Card>
                <CardContent className="pt-2">
                  <button
                    type="button"
                    aria-expanded={othersOpen}
                    aria-controls="hearing-other-fields"
                    onClick={() => setOthersOpen((open) => !open)}
                    className="flex min-h-11 w-full items-center justify-between gap-2 py-2 text-left font-semibold"
                  >
                    <span>
                      {t('meeting.others')}
                      <span className="ml-2 text-sm font-normal text-muted-foreground">
                        {t('meeting.othersCount', { count: otherFieldCount })}
                      </span>
                    </span>
                    <ChevronDown
                      aria-hidden="true"
                      className={cn('h-5 w-5 transition-transform', othersOpen && 'rotate-180')}
                    />
                  </button>
                  {othersOpen && (
                    <div id="hearing-other-fields">
                      {otherSections.map((section) => (
                        <section key={section.id} className="pt-2">
                          <h3 className="border-b pb-2 text-sm font-semibold text-muted-foreground">
                            {t(`sections.${section.id}`)}
                          </h3>
                          {section.fields.map(({ field }) => (
                            <HearingFieldRow
                              key={field.key}
                              field={field}
                              entry={entryOf(form, field.key as HearingFieldKey)}
                              required={false}
                              hint={hints.get(field.key) ?? null}
                              readOnly={readOnly}
                              variant="chip"
                              onValueChange={handleValueChange}
                              onStatusChange={handleStatusChange}
                              onConfirm={handleConfirm}
                              onOtherNoteChange={handleOtherNoteChange}
                            />
                          ))}
                        </section>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          ) : (
            <Tabs value={tab} onValueChange={(value) => setTab(value as HearingSectionId)}>
              <div className="overflow-x-auto">
                <TabsList className="w-max justify-start">
                  {catalog.sections.map(({ id: section }) => {
                    const count = missingBySection.get(section) ?? 0;
                    return (
                      <TabsTrigger key={section} value={section} className="gap-1">
                        {t(`sections.${section}`)}
                        {count > 0 && (
                          <Badge
                            color="amber"
                            size="sm"
                            aria-label={t('editor.missingTabs', { count })}
                          >
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
                      {section.id === 'outcome' && (
                        <div className="pt-4">{requiredItemsCallout}</div>
                      )}
                      {section.fields.map(({ field, required }) => (
                        <HearingFieldRow
                          key={field.key}
                          field={field}
                          entry={entryOf(form, field.key as HearingFieldKey)}
                          required={required}
                          missing={missingKeySet.has(field.key)}
                          hint={hints.get(field.key) ?? null}
                          readOnly={readOnly}
                          onValueChange={handleValueChange}
                          onStatusChange={handleStatusChange}
                          onConfirm={handleConfirm}
                          onOtherNoteChange={handleOtherNoteChange}
                        />
                      ))}
                    </CardContent>
                  </Card>
                </TabsContent>
              ))}
            </Tabs>
          )}
        </TabsContent>
      </Tabs>

      {/* Sticky save bar (record view only) */}
      {view === 'record' && (
        <div
          data-testid="hearing-save-bar"
          className="sticky bottom-0 z-10 -mx-4 border-t bg-white/95 px-4 py-3 backdrop-blur dark:bg-gray-900/95"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {meetingMode && (
                <Badge color={progress.filled === progress.total ? 'emerald' : 'blue'}>
                  {t('meeting.progress', progress)}
                </Badge>
              )}
              {firstMissingItem ? (
                <button
                  type="button"
                  title={t('editor.jumpToMissing')}
                  onClick={() => goToField(firstMissingOf(firstMissingItem.keys))}
                  className="inline-flex min-h-11 items-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 sm:min-h-0"
                >
                  <Badge color="amber">
                    {t('editor.missingCount', { count: missing.missing.length })}
                  </Badge>
                </button>
              ) : (
                <Badge color="emerald">{t('editor.allFilled')}</Badge>
              )}
              {!readOnly && saveStatusText && (
                <span
                  className={cn(
                    'font-medium',
                    saveStatus === 'saved' ? 'text-emerald-700' : 'text-amber-700'
                  )}
                  data-testid="hearing-autosave-status"
                  aria-live="polite"
                >
                  {saveStatusText}
                </span>
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
      )}
    </div>
  );
}
