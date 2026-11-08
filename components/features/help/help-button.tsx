'use client';

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { helpArticleForPath, pathMatchesRoute } from '@/lib/features/help/routes';
import { ChevronRight, CircleHelp } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { HelpArticleView } from './help-article-view';
import { HelpRelated } from './help-related';

const BUTTON_CLASS =
  'flex h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800 lg:h-10 lg:border lg:border-gray-200 lg:px-3 dark:lg:border-gray-800';

/**
 * "How to use this screen" in the app header (Epic #877, #872): opens the help article of the
 * page being shown. The header is shared by every admin page, so the button sits in the same
 * place everywhere; a page without an article links to the help center instead (#874), and the
 * help center itself shows neither.
 */
export function HelpButton() {
  const t = useTranslations('help');
  const locale = useLocale();
  const pathname = usePathname() ?? '';
  const [open, setOpen] = useState(false);
  const article = helpArticleForPath(pathname);
  if (!article) {
    const inHelp = pathMatchesRoute(pathname, '/help') || pathMatchesRoute(pathname, '/help/[id]');
    if (inHelp) return null;
    return (
      <Link href={`/${locale}/help`} className={BUTTON_CLASS}>
        <CircleHelp className="h-5 w-5" aria-hidden="true" />
        <span>{t('menu')}</span>
      </Link>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className={BUTTON_CLASS}
      >
        <CircleHelp className="h-5 w-5" aria-hidden="true" />
        <span>{t('open')}</span>
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
          <div className="min-w-0 flex-1 space-y-4 overflow-y-auto overflow-x-hidden p-6">
            <SheetHeader className="space-y-1 pr-8 text-left">
              <p className="text-xs font-medium text-muted-foreground">{t('open')}</p>
              <SheetTitle className="break-words text-xl font-bold text-foreground">
                {article.title}
              </SheetTitle>
              <SheetDescription className="break-words text-muted-foreground">
                {article.summary}
              </SheetDescription>
            </SheetHeader>
            <HelpArticleView article={article} onNavigate={() => setOpen(false)} />
            <HelpRelated article={article} onNavigate={() => setOpen(false)} />
            <div className="space-y-2 border-t pt-3">
              <Link
                href={`/${locale}/help/${article.id}`}
                onClick={() => setOpen(false)}
                className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-primary underline underline-offset-2 sm:min-h-0"
              >
                {t('openCenter')}
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <p className="text-xs text-muted-foreground">
                {t('reviewedAt', { date: article.reviewedAt })}
              </p>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
