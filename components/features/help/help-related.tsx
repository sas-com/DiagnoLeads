'use client';

import { helpArticleById } from '@/lib/features/help/articles';
import type { HelpArticle } from '@/lib/features/help/types';
import { ChevronRight } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';

/** "Read next": the related articles of an article, as links into the help center (#874) */
export function HelpRelated({
  article,
  onNavigate,
}: {
  article: HelpArticle;
  /** Called when a link is followed (the panel closes) */
  onNavigate?: () => void;
}) {
  const t = useTranslations('help');
  const locale = useLocale();
  const related = (article.related ?? [])
    .map((id) => helpArticleById(id))
    .filter((each): each is HelpArticle => each !== undefined);
  if (related.length === 0) return null;

  return (
    <nav aria-label={t('related')} className="space-y-2">
      <h2 className="text-sm font-bold text-foreground">{t('related')}</h2>
      <ul className="space-y-1">
        {related.map((each) => (
          <li key={each.id}>
            <Link
              href={`/${locale}/help/${each.id}`}
              onClick={onNavigate}
              className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-primary underline underline-offset-2 sm:min-h-0"
            >
              {each.title}
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
