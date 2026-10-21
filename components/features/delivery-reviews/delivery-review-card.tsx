'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  CHECKPOINT_OUTCOMES,
  type CheckpointOutcome,
  DIFFICULTY_LEVELS,
  type DeliveryReviewFields,
  type DifficultyLevel,
  REVIEW_LIMITS,
} from '@/lib/features/delivery-reviews/types/schemas';
import {
  AX_CHECKPOINT_KEYS,
  type AxCheckpointKey,
} from '@/lib/features/diagnostics/ax-migration/evaluate';
import { trpc } from '@/lib/trpc/client';
import { ClipboardCheck, Loader2, X } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { toast } from 'sonner';

/** Select value for "not entered" (Radix Select does not take an empty value) */
const NONE = 'none';

const EMPTY: DeliveryReviewFields = {
  checkpointOutcomes: {},
  actualDifficulty: null,
  estimatedEffort: null,
  actualEffort: null,
  note: null,
};

const isCheckpointKey = (key: string): key is AxCheckpointKey =>
  (AX_CHECKPOINT_KEYS as readonly string[]).includes(key);

/** (actual - estimate) / estimate in percent, one decimal; null without both */
export function effortDeviationPercent(
  estimated: number | null,
  actual: number | null
): number | null {
  if (estimated === null || actual === null || estimated <= 0) return null;
  return Math.round(((actual - estimated) / estimated) * 1000) / 10;
}

const toEffort = (value: string): number | null => {
  if (value.trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

interface DeliveryReviewCardProps {
  organizationId: string;
  leadId: string;
}

/**
 * Delivery review of a won deal (Refs #159): how each checkpoint of the AX diagnosis turned out,
 * the checkpoints the diagnosis missed, the actual difficulty, and the effort against the
 * estimate. Read next to the diagnosis on the analytics page to revise its scoring.
 */
export function DeliveryReviewCard({ organizationId, leadId }: DeliveryReviewCardProps) {
  const t = useTranslations('deliveryReviews');
  const format = useFormatter();
  const id = useId();
  const utils = trpc.useUtils();
  const query = trpc.deliveryReviews.get.useQuery(
    { organizationId, leadId },
    { enabled: !!organizationId, retry: false }
  );
  const [form, setForm] = useState<DeliveryReviewFields | null>(null);
  const save = trpc.deliveryReviews.save.useMutation({
    onSuccess: () => {
      setForm(null);
      utils.deliveryReviews.get.invalidate({ organizationId, leadId });
      utils.deliveryReviews.report.invalidate({ organizationId });
      toast.success(t('saved'));
    },
    onError: () => toast.error(t('saveError')),
  });

  if (query.isError) return null;
  const data = query.data;
  const saved = data?.review ?? null;
  const values: DeliveryReviewFields = form ?? (saved ? { ...EMPTY, ...saved } : EMPTY);
  const canEdit = data?.canEdit ?? false;
  const update = (patch: Partial<DeliveryReviewFields>) => setForm({ ...values, ...patch });

  const flagged = (data?.diagnosis?.checkpoints ?? []).filter(isCheckpointKey);
  const others = Object.keys(values.checkpointOutcomes)
    .filter(isCheckpointKey)
    .filter((key) => !flagged.includes(key));
  const addable = AX_CHECKPOINT_KEYS.filter(
    (key) => !flagged.includes(key) && !others.includes(key)
  );
  const setOutcome = (key: AxCheckpointKey, outcome: CheckpointOutcome | null) => {
    const next = { ...values.checkpointOutcomes };
    if (outcome) next[key] = outcome;
    else delete next[key];
    update({ checkpointOutcomes: next });
  };
  const deviation = effortDeviationPercent(values.estimatedEffort, values.actualEffort);

  const outcomeRow = (key: AxCheckpointKey, removable: boolean) => {
    const label = t(`checkpoints.${key}`);
    const outcome = values.checkpointOutcomes[key];
    return (
      <li key={key} className="flex flex-wrap items-center gap-2 text-sm">
        <span className="min-w-0 flex-1 break-words text-foreground">{label}</span>
        {canEdit ? (
          <>
            <Select
              value={outcome ?? NONE}
              onValueChange={(value) =>
                setOutcome(key, value === NONE ? null : (value as CheckpointOutcome))
              }
            >
              <SelectTrigger className="h-9 w-44" aria-label={t('outcome', { label })}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t('unrecorded')}</SelectItem>
                {CHECKPOINT_OUTCOMES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(`outcomes.${value}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {removable && (
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-9 w-9"
                aria-label={t('remove', { label })}
                onClick={() => setOutcome(key, null)}
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </Button>
            )}
          </>
        ) : (
          <Badge color={outcome === 'hard' ? 'amber' : 'gray'}>
            {outcome ? t(`outcomes.${outcome}`) : t('unrecorded')}
          </Badge>
        )}
      </li>
    );
  };

  return (
    <Card className="p-5">
      <div className="mb-1 flex items-center gap-2">
        <ClipboardCheck className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-foreground">{t('title')}</h2>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">{t('description')}</p>

      {!data ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />
      ) : (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate({ organizationId, leadId, review: values });
          }}
        >
          {data.diagnosis ? (
            data.diagnosis.difficulty && (
              <p className="text-xs text-muted-foreground">
                {t('diagnosisLevel', { level: t(`levels.${data.diagnosis.difficulty}`) })}
              </p>
            )
          ) : (
            <p className="text-xs text-muted-foreground">{t('noDiagnosis')}</p>
          )}

          {flagged.length > 0 && (
            <section aria-labelledby={`${id}-flagged`}>
              <h3 id={`${id}-flagged`} className="mb-1 text-xs text-muted-foreground">
                {t('flaggedTitle')}
              </h3>
              <ul className="space-y-1.5">{flagged.map((key) => outcomeRow(key, false))}</ul>
            </section>
          )}

          {(others.length > 0 || canEdit) && (
            <section aria-labelledby={`${id}-others`}>
              <h3 id={`${id}-others`} className="mb-1 text-xs text-muted-foreground">
                {t('otherTitle')}
              </h3>
              {others.length > 0 && (
                <ul className="mb-2 space-y-1.5">{others.map((key) => outcomeRow(key, true))}</ul>
              )}
              {canEdit && addable.length > 0 && (
                <Select
                  value=""
                  onValueChange={(key) => setOutcome(key as AxCheckpointKey, 'hard')}
                >
                  <SelectTrigger className="h-9 w-full sm:w-72" aria-label={t('addOther')}>
                    <SelectValue placeholder={t('addOther')} />
                  </SelectTrigger>
                  <SelectContent>
                    {addable.map((key) => (
                      <SelectItem key={key} value={key}>
                        {t(`checkpoints.${key}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </section>
          )}

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor={`${id}-difficulty`} className="text-xs">
                {t('actualDifficulty')}
              </Label>
              <Select
                value={values.actualDifficulty ?? NONE}
                disabled={!canEdit}
                onValueChange={(value) =>
                  update({ actualDifficulty: value === NONE ? null : (value as DifficultyLevel) })
                }
              >
                <SelectTrigger id={`${id}-difficulty`} className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t('unrecorded')}</SelectItem>
                  {DIFFICULTY_LEVELS.map((level) => (
                    <SelectItem key={level} value={level}>
                      {t(`levels.${level}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {(['estimatedEffort', 'actualEffort'] as const).map((key) => (
              <div key={key} className="space-y-1">
                <Label htmlFor={`${id}-${key}`} className="text-xs">
                  {t(key)}
                </Label>
                <Input
                  id={`${id}-${key}`}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={REVIEW_LIMITS.effort}
                  step={0.1}
                  className="h-9"
                  readOnly={!canEdit}
                  value={values[key] ?? ''}
                  onChange={(event) => update({ [key]: toEffort(event.target.value) })}
                />
              </div>
            ))}
          </div>
          {deviation !== null && (
            <p
              className={`text-sm ${deviation > 0 ? 'text-red-700 dark:text-red-400' : 'text-foreground'}`}
            >
              {t('deviation', { value: deviation > 0 ? `+${deviation}` : String(deviation) })}
            </p>
          )}

          <div className="space-y-1">
            <Label htmlFor={`${id}-note`} className="text-xs">
              {t('note')}
            </Label>
            <Textarea
              id={`${id}-note`}
              rows={3}
              maxLength={REVIEW_LIMITS.note}
              readOnly={!canEdit}
              value={values.note ?? ''}
              onChange={(event) => update({ note: event.target.value || null })}
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {canEdit && (
              <Button type="submit" size="sm" disabled={form === null || save.isPending}>
                {save.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                {t('save')}
              </Button>
            )}
            {saved && (
              <p className="text-xs text-muted-foreground">
                {t('updated', {
                  name: saved.updatedByName ?? '—',
                  date: format.dateTime(new Date(saved.updatedAt), { dateStyle: 'medium' }),
                })}
              </p>
            )}
          </div>
        </form>
      )}
    </Card>
  );
}
