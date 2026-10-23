'use client';

import { AxCrossLink } from '@/components/features/ax-site/ax-cross-link';
import { ColumnThumbnail } from '@/components/features/ax-site/column-thumbnail';
import { columnPath, getColumn } from '@/lib/features/ax-site/columns';
import { resultColumnSlug } from '@/lib/features/ax-site/result-column';
import type { DiagnosticAnswers, DiagnosticLocale } from '@/lib/features/diagnostics/types';
import { useTranslations } from 'next-intl';
import { createElement, useState } from 'react';

interface ResultColumnLinkProps {
  platform: string;
  locale: DiagnosticLocale;
  /** Answers of the diagnosis, with the follow-up answers once they are sent */
  answers: DiagnosticAnswers;
  headingTag: 'h2' | 'h4';
}

/**
 * The one column that fits the Access answers (#363), under the consultation block: a plain card
 * that stays quieter than the consultation button, left out on paper. The article opens in a new
 * tab, unlike the other links between AX pages: the result lives only in memory, and coming back
 * from the article in the same tab could lose it, and the consultation with it.
 * The link carries `from=<page>-result`.
 * Nothing for the other systems, or for a locale without articles.
 */
export function ResultColumnLink({ platform, locale, answers, headingTag }: ResultColumnLinkProps) {
  const t = useTranslations('axDiagnosis.result.column');
  // Support end is judged at the time the result is shown, as the evaluation did on sending
  const [now] = useState(() => new Date());
  const slug = resultColumnSlug(platform, answers, now);
  const column = slug ? getColumn(slug) : undefined;
  if (!column || column.locale !== locale) return null;

  const headingId = 'ax-result-column-heading';
  return (
    <section
      aria-labelledby={headingId}
      className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5 print:hidden"
      data-testid="ax-result-column"
      data-column={column.slug}
    >
      {createElement(
        headingTag,
        { id: headingId, className: 'text-xs font-bold text-ax-teal-dark' },
        t('label')
      )}
      <div className="mt-3 flex items-start gap-4">
        <ColumnThumbnail
          slug={column.slug}
          sizes="(min-width: 640px) 160px, 112px"
          className="w-28 shrink-0 rounded-lg sm:w-40"
        />
        <div className="min-w-0 space-y-1">
          <AxCrossLink
            href={`/${column.locale}${columnPath(column.slug)}`}
            placement="result"
            columnSlug={column.slug}
            newTab
            className="font-bold leading-snug text-ax-teal-dark underline underline-offset-4 hover:text-ax-deep focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ax-teal-dark"
          >
            {column.title}
            <span className="sr-only">{t('newTab')}</span>
          </AxCrossLink>
          <p className="line-clamp-2 text-sm leading-relaxed text-gray-700">{column.description}</p>
        </div>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-gray-600">{t('note')}</p>
    </section>
  );
}
