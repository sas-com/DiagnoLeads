'use client';

import { STUDIO_PAGE_CLASS, StudioPageHeader, StudioSection } from '@/components/studio';
import { Input } from '@/components/ui/input';
import { HELP_TABLE_OF_CONTENTS } from '@/lib/features/help/articles';
import { searchHelpArticles } from '@/lib/features/help/search';
import { HELP_SECTIONS, type HelpArticle } from '@/lib/features/help/types';
import { cn } from '@/lib/utils';
import { ChevronRight, Search } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useId, useMemo, useState } from 'react';

const ALL_ARTICLES = HELP_SECTIONS.flatMap((section) => HELP_TABLE_OF_CONTENTS[section]);

/** The help center (#874): a search over every article, or the table of contents */
export function HelpCenter() {
  const t = useTranslations('help.center');
  const searchId = useId();
  const [query, setQuery] = useState('');
  const results = useMemo(() => searchHelpArticles(query, ALL_ARTICLES), [query]);
  const searching = query.trim() !== '';

  return (
    <div className={cn(STUDIO_PAGE_CLASS, 'space-y-8 py-1 sm:px-2 sm:py-6')}>
      <StudioPageHeader title={t('title')} description={t('description')} />
      <div className="max-w-xl space-y-2">
        <label htmlFor={searchId} className="text-sm font-bold text-foreground">
          {t('searchLabel')}
        </label>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            id={searchId}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('searchPlaceholder')}
            className="h-11 pl-9"
          />
        </div>
      </div>

      {searching ? (
        <section aria-live="polite" className="space-y-3">
          {results.length > 0 ? (
            <>
              <p className="text-sm text-muted-foreground">
                {t('resultCount', { count: results.length })}
              </p>
              <ArticleList articles={results} />
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t('noResults', { query: query.trim() })}
            </p>
          )}
        </section>
      ) : (
        <nav aria-label={t('tocLabel')} className="space-y-10">
          {HELP_SECTIONS.map((section) => (
            <StudioSection key={section} title={t(`sections.${section}`)}>
              <ArticleList articles={HELP_TABLE_OF_CONTENTS[section]} />
            </StudioSection>
          ))}
        </nav>
      )}
    </div>
  );
}

function ArticleList({ articles }: { articles: readonly HelpArticle[] }) {
  const locale = useLocale();
  return (
    <ul className="divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white dark:divide-gray-800 dark:border-gray-800 dark:bg-gray-900">
      {articles.map((article) => (
        <li key={article.id}>
          <Link
            href={`/${locale}/help/${article.id}`}
            className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            <span className="min-w-0">
              <span className="block font-bold text-foreground">{article.title}</span>
              <span className="mt-0.5 block text-sm text-muted-foreground">{article.summary}</span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </Link>
        </li>
      ))}
    </ul>
  );
}
