'use client';

import { InlineLoadError } from '@/components/common/inline-load-error';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { buildPrepDraft, hasDraftMaterial, isPrepReady } from '@/lib/features/lead-prep/draft';
import {
  PREP_CHALLENGES,
  PREP_LIMITS,
  type PrepCardFields,
} from '@/lib/features/lead-prep/types/schemas';
import { trpc } from '@/lib/trpc/client';
import { Loader2, Pencil, Search, Sparkles } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useId, useState } from 'react';
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
  const save = trpc.leadPrep.save.useMutation({
    onSuccess: () => {
      setForm(null);
      utils.leadPrep.get.invalidate({ organizationId, leadId });
      toast.success(t('saved'));
    },
    onError: () => toast.error(t('saveError')),
  });

  // A failed request shows an error in the card (#431); only "not allowed" hides it
  if (query.error?.data?.code === 'FORBIDDEN') return null;
  const data = query.data;
  const card = data?.card ?? null;
  const editing = form !== null;

  const startEditing = () =>
    setForm(
      card
        ? {
            estimatedSystem: card.estimatedSystem,
            estimatedSystemBasis: card.estimatedSystemBasis,
            recentNews: card.recentNews,
            hypotheses: { ...card.hypotheses },
            firstQuestions: [...card.firstQuestions],
          }
        : EMPTY
    );

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
          <Button size="sm" variant="ghost" className="ml-auto h-8" onClick={startEditing}>
            <Pencil className="mr-1 h-4 w-4" aria-hidden="true" />
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
            save.mutate({ organizationId, leadId, card: form });
          }}
        >
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
            <Button type="submit" size="sm" disabled={save.isPending}>
              {save.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              {t('save')}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setForm(null)}>
              {t('cancel')}
            </Button>
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
