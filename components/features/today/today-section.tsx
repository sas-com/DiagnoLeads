'use client';

import { TAP_TARGET } from '@/components/common/tap-target';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { ArrowRight, RotateCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { type ReactNode, useId } from 'react';

/** What a section reads of its tRPC query */
export interface TodayQuery<T> {
  data: T | undefined;
  isError: boolean;
  error: { data?: { code?: string } | null } | null;
  refetch: () => unknown;
}

/** Where a section's query stands */
export interface SectionState {
  isError: boolean;
  /** The data has come: the section shows its content, or that there is none */
  loaded: boolean;
  /** Nothing to list */
  empty: boolean;
  retry: () => void;
}

/** The link to a section's whole list (underlined, a tap target on phones) */
const SECTION_LINK_CLASS = cn(
  'inline-flex items-center gap-1 rounded-md px-1 text-sm font-medium text-brand-700 underline underline-offset-4 hover:text-brand-800 dark:text-brand-300 dark:hover:text-brand-200',
  TAP_TARGET
);

/**
 * A section of 今日 (#556): a heading with how many there are, a link to the whole list, and the
 * section's own loading, failure (with a retry) and empty states, so one that fails to load
 * leaves the others shown. Framed like the next actions card next to it, without a shadow and
 * with no text under 14px (DADS, decision 2026-10-24-admin-dads).
 */
export function TodaySection({
  title,
  description,
  count,
  link,
  state,
  emptyText,
  children,
}: {
  title: string;
  description: string;
  /** How many there are, shown with the heading once loaded (nothing for none) */
  count?: number;
  /** The whole list, at the right of the heading */
  link?: { href: string; label: string };
  state: SectionState;
  emptyText: string;
  children: ReactNode;
}) {
  const t = useTranslations('today.section');
  const headingId = useId();

  return (
    <section
      aria-labelledby={headingId}
      className="rounded-lg border bg-white p-4 text-gray-900 sm:p-6 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-50"
    >
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2
            id={headingId}
            className="text-base font-semibold text-gray-900 sm:text-lg dark:text-gray-50"
          >
            {title}
            {state.loaded && !state.isError && count !== undefined && count > 0 && (
              <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-sm font-bold text-gray-800 dark:bg-gray-800 dark:text-gray-200">
                {t('count', { count })}
              </span>
            )}
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-300">{description}</p>
        </div>
        {link && (
          <Link href={link.href} className={SECTION_LINK_CLASS}>
            {link.label}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        )}
      </div>
      {state.isError ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-center gap-3 rounded-lg bg-rose-50 px-4 py-4 text-sm text-rose-800 dark:bg-rose-500/10 dark:text-rose-200"
        >
          {t('loadError')}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={TAP_TARGET}
            onClick={state.retry}
          >
            <RotateCw aria-hidden="true" />
            {t('retry')}
          </Button>
        </div>
      ) : !state.loaded ? (
        <div className="space-y-3" aria-busy="true">
          <span className="sr-only">{t('loading')}</span>
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : state.empty ? (
        <p className="rounded-lg bg-gray-50 px-4 py-6 text-center text-sm text-gray-600 dark:bg-gray-800/50 dark:text-gray-300">
          {emptyText}
        </p>
      ) : (
        children
      )}
    </section>
  );
}

/** The state of a section from its tRPC query */
export function sectionState(query: TodayQuery<unknown>, empty: boolean): SectionState {
  return {
    isError: query.isError,
    loaded: query.data !== undefined,
    empty,
    retry: () => void query.refetch(),
  };
}
