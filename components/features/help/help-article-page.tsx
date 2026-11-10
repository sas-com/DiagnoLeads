'use client';

import { STUDIO_PAGE_CLASS, StudioPageHeader } from '@/components/studio';
import type { HelpArticle } from '@/lib/features/help/types';
import { cn } from '@/lib/utils';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { HelpArticleView } from './help-article-view';
import { HelpRelated } from './help-related';

/** An article of the help center, with a link to its screen and the articles to read next (#874) */
export function HelpArticlePage({ article }: { article: HelpArticle }) {
  const t = useTranslations('help');
  const locale = useLocale();
  // A route with a parameter (a lead, a deal) has no single page to open
  const screen = article.routes.find((route) => !route.includes('['));

  return (
    <div className={cn(STUDIO_PAGE_CLASS, 'space-y-6 py-1 sm:px-2 sm:py-6')}>
      <Link
        href={`/${locale}/help`}
        className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {t('center.back')}
      </Link>
      <StudioPageHeader
        title={article.title}
        description={article.summary}
        actions={
          screen ? (
            <Link
              href={`/${locale}${screen}`}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-gray-400 bg-white px-4 py-2 text-sm font-bold text-gray-900 hover:bg-gray-50 dark:border-gray-500 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800"
            >
              {t('center.openScreen')}
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
            </Link>
          ) : undefined
        }
      />
      <div className="max-w-3xl space-y-8">
        <HelpArticleView article={article} />
        <HelpRelated article={article} />
        <p className="border-t pt-3 text-xs text-muted-foreground">
          {t('reviewedAt', { date: article.reviewedAt })}
        </p>
      </div>
    </div>
  );
}
