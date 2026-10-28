'use client';

import { Button } from '@/components/ui/button';
import {
  EMPTY_ONBOARDING_STATE,
  ONBOARDING_ITEMS,
  type OnboardingAudience,
  type OnboardingSignal,
  type OnboardingState,
  isOnboardingItemDone,
  onboardingAudience,
  onboardingStorageKey,
  parseOnboardingState,
} from '@/lib/features/help/onboarding';
import { trpc } from '@/lib/trpc/client';
import { cn } from '@/lib/utils';
import { CheckCircle2, ChevronRight, Circle, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, useState } from 'react';

function readState(organizationId: string): OnboardingState {
  try {
    return parseOnboardingState(localStorage.getItem(onboardingStorageKey(organizationId)));
  } catch {
    return EMPTY_ONBOARDING_STATE;
  }
}

function writeState(organizationId: string, state: OnboardingState) {
  try {
    localStorage.setItem(onboardingStorageKey(organizationId), JSON.stringify(state));
  } catch {
    // Storage unavailable (private mode): the checklist comes back on the next visit
  }
}

/**
 * The first-day checklist at the top of the dashboard (Epic #877, #875): setup steps for owners
 * and admins, first steps for members. Closing it hides it in this browser for this
 * organization, like the dashboard's widget settings.
 */
export function OnboardingChecklist({ organizationId }: { organizationId: string }) {
  // Read after mounting: the server render has no localStorage
  const [state, setState] = useState<OnboardingState | null>(null);
  useEffect(() => setState(readState(organizationId)), [organizationId]);

  const organization = trpc.organizations.getById.useQuery(
    { id: organizationId },
    { enabled: state !== null && !state.dismissed, staleTime: 5 * 60 * 1000 }
  );
  const audience = onboardingAudience(organization.data?.role);

  if (!state || state.dismissed || !audience) return null;

  const save = (next: OnboardingState) => {
    setState(next);
    writeState(organizationId, next);
  };
  return (
    <ChecklistCard
      organizationId={organizationId}
      audience={audience}
      state={state}
      onChange={save}
    />
  );
}

/** What the organization's data says is done; read only for those who set it up */
function useSignals(
  organizationId: string,
  enabled: boolean
): Partial<Record<OnboardingSignal, boolean>> {
  const options = { enabled, staleTime: 60 * 1000, retry: false } as const;
  const intake = trpc.leads.intake.useQuery({ organizationId }, options);
  const members = trpc.members.list.useQuery({ organizationId, limit: 2, offset: 0 }, options);
  const invitations = trpc.members.listInvitations.useQuery({ organizationId }, options);
  const playbook = trpc.axPlaybook.get.useQuery({ organizationId }, options);
  const links = trpc.agencyLinks.list.useQuery({ organizationId }, options);
  return {
    intake: (intake.data?.userIds.length ?? 0) > 0,
    members:
      (members.data?.total ?? 0) >= 2 ||
      (invitations.data ?? []).some((invitation) => !invitation.expired),
    playbook: Boolean(playbook.data?.updatedAt),
    agencyLinks: (links.data?.links.length ?? 0) > 0,
  };
}

function ChecklistCard({
  organizationId,
  audience,
  state,
  onChange,
}: {
  organizationId: string;
  audience: OnboardingAudience;
  state: OnboardingState;
  onChange: (state: OnboardingState) => void;
}) {
  const t = useTranslations('help.checklist');
  const locale = useLocale();
  const signals = useSignals(organizationId, audience === 'manager');
  const items = ONBOARDING_ITEMS[audience];
  const doneCount = items.filter((item) => isOnboardingItemDone(item, state, signals)).length;
  const toggle = (id: string) =>
    onChange({
      ...state,
      done: state.done.includes(id)
        ? state.done.filter((each) => each !== id)
        : [...state.done, id],
    });

  return (
    <section
      aria-labelledby="onboarding-checklist-title"
      className="rounded-lg border border-gray-200 bg-white p-4 sm:p-6 dark:border-gray-800 dark:bg-gray-900"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2
            id="onboarding-checklist-title"
            className="text-lg font-bold text-gray-900 dark:text-gray-50"
          >
            {t(`title.${audience}`)}
          </h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {doneCount === items.length
              ? t('allDone')
              : t('progress', { done: doneCount, total: items.length })}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-11 w-11 shrink-0"
          aria-label={t('close')}
          onClick={() => onChange({ ...state, dismissed: true })}
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </Button>
      </div>
      <ol className="mt-4 divide-y divide-gray-200 dark:divide-gray-800">
        {items.map((item) => {
          const done = isOnboardingItemDone(item, state, signals);
          const byHand = !item.detect || !signals[item.detect];
          const title = t(`items.${item.id}.title`);
          return (
            <li key={item.id} className="flex flex-wrap items-start gap-3 py-3">
              {done ? (
                <CheckCircle2
                  className="mt-0.5 h-5 w-5 shrink-0 text-green-600"
                  aria-hidden="true"
                />
              ) : (
                <Circle className="mt-0.5 h-5 w-5 shrink-0 text-gray-400" aria-hidden="true" />
              )}
              <div className="min-w-0 flex-1 basis-60">
                <p
                  className={cn(
                    'font-bold text-gray-900 dark:text-gray-50',
                    done && 'text-gray-500'
                  )}
                >
                  {title}
                  <span className="sr-only">{done ? t('doneMark') : t('notDoneMark')}</span>
                </p>
                <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
                  {t(`items.${item.id}.description`)}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pl-8 sm:pl-0">
                <Link
                  href={`/${locale}${item.href}`}
                  className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-primary underline underline-offset-2"
                >
                  {t('open')}
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </Link>
                <Link
                  href={`/${locale}/help/${item.articleId}${item.anchor ? `#${item.anchor}` : ''}`}
                  className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline underline-offset-2"
                  aria-label={t('guideOf', { title })}
                >
                  {t('guide')}
                </Link>
                {byHand && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-11 sm:h-9"
                    aria-label={done ? t('markUndoneOf', { title }) : t('markDoneOf', { title })}
                    onClick={() => toggle(item.id)}
                  >
                    {done ? t('markUndone') : t('markDone')}
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
