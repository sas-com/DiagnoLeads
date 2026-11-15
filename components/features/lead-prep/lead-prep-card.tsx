'use client';

import { InlineLoadError } from '@/components/common/inline-load-error';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  buildPrepDraft,
  hasDraftMaterial,
  isPrepReady,
  prepCardFilled,
} from '@/lib/features/lead-prep/draft';
import {
  PREP_CHALLENGES,
  PREP_LIMITS,
  type PrepCardFields,
} from '@/lib/features/lead-prep/types/schemas';
import { trpc } from '@/lib/trpc/client';
import { AlertTriangle, Loader2, Pencil, RefreshCw, Search, Sparkles } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState } from 'react';
import { toast } from 'sonner';

const EMPTY: PrepCardFields = {
  estimatedSystem: null,
  estimatedSystemBasis: null,
  recentNews: null,
  hypotheses: {},
  firstQuestions: [],
};

interface LeadPrepCardProps {
  organizationId: string;
  leadId: string;
}

/**
 * Pre-meeting prep card (Refs #156): the guessed core system and why, recent news, a hypothesis
 * per challenge and the first three questions. A draft fills the empty fields from the diagnosis
 * and the sales playbook; nothing is saved until 保存. Works for leads without a diagnosis too.
 *
 * Saving replaces the whole card, so it is only taken while the card is still as it was when the
 * editing started (#1225, like the hearing editor): when somebody else saved it meanwhile (the
 * office drafts this card too), the save is refused, what was typed stays in the form, and the
 * card can be read again. A card saved empty is shown as none.
 */
export function LeadPrepCard({ organizationId, leadId }: LeadPrepCardProps) {
  const t = useTranslations('leadPrep');
  const tAll = useTranslations();
  const tChallenge = useTranslations('leadHearings.options.challenge');
  const format = useFormatter();
  const id = useId();
  const utils = trpc.useUtils();
  const query = trpc.leadPrep.get.useQuery(
    { organizationId, leadId },
    { enabled: !!organizationId, retry: false }
  );
  const [form, setForm] = useState<PrepCardFields | null>(null);
  // The card's updatedAt when the editing started (null: there was no card). Kept apart from the
  // query: the query can be read again while the form is open (the office saves the same card),
  // and a token taken at the save would then be the new one, letting the save write over it
  const [base, setBase] = useState<Date | null>(null);
  const [conflict, setConflict] = useState(false);
  // Reading the card before an editing starts, and reading it again after a refusal
  const [reading, setReading] = useState<'start' | 'reload' | null>(null);
  const conflictRef = useRef<HTMLDivElement>(null);
  // The notice sits at the top of a long form and the save button at its foot: when a save is
  // refused, the notice is brought into view and takes the focus, so that it is seen and read out
  useEffect(() => {
    if (!conflict) return;
    conflictRef.current?.scrollIntoView?.({ block: 'center' });
    conflictRef.current?.focus();
  }, [conflict]);
  const save = trpc.leadPrep.save.useMutation({
    onSuccess: () => {
      setForm(null);
      setConflict(false);
      utils.leadPrep.get.invalidate({ organizationId, leadId });
      toast.success(t('saved'));
    },
    onError: (error) => {
      // Somebody else saved first: what was typed stays (it is in the form), until the card is
      // read again. The card behind the form is read anew, so that after a cancel the card shown
      // and the next editing start from what is saved now, not from the copy that was refused
      if (error.data?.code === 'CONFLICT') {
        setConflict(true);
        void utils.leadPrep.get.invalidate({ organizationId, leadId });
      } else toast.error(t('saveError'));
    },
  });

  // A failed request shows an error in the card (#431); only "not allowed" hides it
  if (query.error?.data?.code === 'FORBIDDEN') return null;
  const data = query.data;
  // The row as it is stored: its updatedAt is the token, also when the card says nothing
  const stored = data?.card ?? null;
  // A card saved empty is shown as none (undoing a draft in the office leaves such a row)
  const card = stored && prepCardFilled(stored) ? stored : null;
  const editing = form !== null;

  const fill = (from: typeof stored) => {
    setForm(
      from
        ? {
            estimatedSystem: from.estimatedSystem,
            estimatedSystemBasis: from.estimatedSystemBasis,
            recentNews: from.recentNews,
            hypotheses: { ...from.hypotheses },
            firstQuestions: [...from.firstQuestions],
          }
        : EMPTY
    );
    setBase(from?.updatedAt ?? null);
    setConflict(false);
  };
  // The card on the screen can be minutes old (the app keeps a query for five minutes and does
  // not read it again on focus): an editing that started from it would be refused at the save,
  // after everything was typed. So the card is read first, and the form starts from that
  const startEditing = async () => {
    setReading('start');
    const latest = await query.refetch();
    setReading(null);
    // A read that failed still hands back the card from before (the query keeps it): only a
    // read that went through may fill the form
    if (latest.isSuccess) fill(latest.data.card);
    else toast.error(t('startError'));
  };
  // Read the card as it is now and start over from it: what was typed is dropped
  const reload = async () => {
    setReading('reload');
    const latest = await query.refetch();
    setReading(null);
    if (latest.isSuccess) {
      fill(latest.data.card);
      toast.success(t('reloaded'));
      // The notice, which had the focus, is gone: the form's first field takes it
      document.getElementById(`${id}-system`)?.focus();
    } else toast.error(t('reloadError'));
  };

  const draft = () => {
    if (!form || !data?.draftSource) return;
    setForm(buildPrepDraft(form, data.draftSource, (key, values) => tAll(key, values)));
    toast.success(t('drafted'));
  };

  const questions = Array.from(
    { length: PREP_LIMITS.questions },
    (_, index) => form?.firstQuestions[index] ?? ''
  );
  const setText = (key: 'estimatedSystem' | 'estimatedSystemBasis' | 'recentNews', value: string) =>
    form && setForm({ ...form, [key]: value || null });

  return (
    <Card className="p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Search className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-foreground">{t('title')}</h2>
        {card && isPrepReady(card) && <Badge color="emerald">{t('ready')}</Badge>}
        {data?.canEdit && !editing && (
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto h-8"
            disabled={reading === 'start'}
            aria-busy={reading === 'start'}
            onClick={() => void startEditing()}
          >
            {reading === 'start' ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Pencil className="mr-1 h-4 w-4" aria-hidden="true" />
            )}
            {card ? t('edit') : t('start')}
          </Button>
        )}
      </div>

      {!data && query.isError ? (
        <InlineLoadError onRetry={() => void query.refetch()} />
      ) : !data ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />
      ) : editing && form ? (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            // A save that is known to be refused is not sent again
            if (conflict) return;
            save.mutate({ organizationId, leadId, card: form, expectedUpdatedAt: base });
          }}
        >
          {conflict && (
            <div ref={conflictRef} role="alert" tabIndex={-1} className="outline-none">
              <Callout title={t('conflictTitle')} icon={AlertTriangle} color="red">
                <p>{t('conflictBody')}</p>
                {/* Who saved the card that is there now, and when (it was read after the refusal) */}
                {stored && stored.updatedAt.getTime() !== base?.getTime() && (
                  <p className="mt-1">
                    {t('conflictSavedBy', {
                      date: format.dateTime(stored.updatedAt, {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      }),
                      name: stored.updatedByName ?? '—',
                    })}
                  </p>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  disabled={reading === 'reload'}
                  onClick={() => void reload()}
                >
                  {reading === 'reload' ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <RefreshCw className="h-4 w-4" aria-hidden="true" />
                  )}
                  {t('reload')}
                </Button>
              </Callout>
            </div>
          )}
          {data.draftSource && hasDraftMaterial(data.draftSource) && (
            <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground">{t('draftHint')}</p>
              <Button type="button" size="sm" variant="outline" onClick={draft}>
                <Sparkles className="mr-1 h-4 w-4" aria-hidden="true" />
                {t('draft')}
              </Button>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor={`${id}-system`} className="text-xs">
                {t('fields.estimatedSystem')}
              </Label>
              <Input
                id={`${id}-system`}
                maxLength={PREP_LIMITS.estimatedSystem}
                value={form.estimatedSystem ?? ''}
                onChange={(event) => setText('estimatedSystem', event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${id}-basis`} className="text-xs">
                {t('fields.estimatedSystemBasis')}
              </Label>
              <Input
                id={`${id}-basis`}
                maxLength={PREP_LIMITS.basis}
                placeholder={t('basisPlaceholder')}
                value={form.estimatedSystemBasis ?? ''}
                onChange={(event) => setText('estimatedSystemBasis', event.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${id}-news`} className="text-xs">
              {t('fields.recentNews')}
            </Label>
            <Textarea
              id={`${id}-news`}
              rows={2}
              maxLength={PREP_LIMITS.recentNews}
              placeholder={t('newsPlaceholder')}
              value={form.recentNews ?? ''}
              onChange={(event) => setText('recentNews', event.target.value)}
            />
          </div>
          <fieldset className="space-y-2">
            <legend className="text-xs text-muted-foreground">{t('fields.hypotheses')}</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {PREP_CHALLENGES.map((challenge) => (
                <div key={challenge} className="space-y-1">
                  <Label htmlFor={`${id}-h-${challenge}`} className="text-xs">
                    {tChallenge(challenge)}
                  </Label>
                  <Textarea
                    id={`${id}-h-${challenge}`}
                    rows={2}
                    maxLength={PREP_LIMITS.hypothesis}
                    value={form.hypotheses[challenge] ?? ''}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        hypotheses: { ...form.hypotheses, [challenge]: event.target.value },
                      })
                    }
                  />
                </div>
              ))}
            </div>
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="text-xs text-muted-foreground">{t('fields.firstQuestions')}</legend>
            {questions.map((question, index) => (
              <Input
                // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list of three questions
                key={index}
                aria-label={t('questionLabel', { number: index + 1 })}
                maxLength={PREP_LIMITS.question}
                value={question}
                onChange={(event) => {
                  const next = [...questions];
                  next[index] = event.target.value;
                  setForm({ ...form, firstQuestions: next });
                }}
              />
            ))}
          </fieldset>
          <div className="flex flex-wrap gap-2">
            {/* Closed after a refusal: the same save would be refused again */}
            <Button type="submit" size="sm" disabled={save.isPending || conflict}>
              {save.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              {t('save')}
            </Button>
            {/* Closed while a save is out: a form closed now would never show that it was refused */}
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={save.isPending}
              onClick={() => {
                setForm(null);
                setConflict(false);
              }}
            >
              {t('cancel')}
            </Button>
            {/* Next to the button that was pressed: why nothing was saved */}
            <output className="self-center text-xs text-red-700 dark:text-red-400">
              {conflict ? t('conflictStatus') : ''}
            </output>
          </div>
        </form>
      ) : !card ? (
        <p className="text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <dl className="space-y-3 text-sm">
          {card.estimatedSystem && (
            <div>
              <dt className="text-xs text-muted-foreground">{t('fields.estimatedSystem')}</dt>
              <dd className="text-foreground">
                {card.estimatedSystem}
                {card.estimatedSystemBasis && (
                  <span className="text-muted-foreground">
                    {t('basisInline', { basis: card.estimatedSystemBasis })}
                  </span>
                )}
              </dd>
            </div>
          )}
          {card.recentNews && (
            <div>
              <dt className="text-xs text-muted-foreground">{t('fields.recentNews')}</dt>
              <dd className="whitespace-pre-wrap break-words text-foreground">{card.recentNews}</dd>
            </div>
          )}
          {Object.keys(card.hypotheses).length > 0 && (
            <div>
              <dt className="text-xs text-muted-foreground">{t('fields.hypotheses')}</dt>
              <dd>
                <ul className="space-y-0.5">
                  {PREP_CHALLENGES.filter((c) => card.hypotheses[c]).map((challenge) => (
                    <li key={challenge} className="break-words text-foreground">
                      <span className="font-medium">{tChallenge(challenge)}</span>：
                      {card.hypotheses[challenge]}
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          )}
          <div>
            <dt className="text-xs text-muted-foreground">{t('fields.firstQuestions')}</dt>
            <dd>
              {card.firstQuestions.length > 0 ? (
                <ol className="list-decimal space-y-0.5 pl-5 text-foreground">
                  {card.firstQuestions.map((question) => (
                    <li key={question} className="break-words">
                      {question}
                    </li>
                  ))}
                </ol>
              ) : (
                <span className="text-muted-foreground">{t('noQuestions')}</span>
              )}
            </dd>
          </div>
          <p className="text-xs text-muted-foreground">
            {t('updatedBy', {
              date: format.dateTime(new Date(card.updatedAt), { dateStyle: 'medium' }),
              name: card.updatedByName ?? '—',
            })}
          </p>
        </dl>
      )}
    </Card>
  );
}
