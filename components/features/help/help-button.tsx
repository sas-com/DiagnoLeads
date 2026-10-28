'use client';

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { helpArticleForPath } from '@/lib/features/help/routes';
import { CircleHelp } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { HelpArticleView } from './help-article-view';

/**
 * "How to use this screen" in the app header (Epic #877, #872): opens the help article of the
 * page being shown. The header is shared by every admin page, so the button sits in the same
 * place everywhere; a page without an article yet shows no button.
 */
export function HelpButton() {
  const t = useTranslations('help');
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const article = helpArticleForPath(pathname ?? '');
  if (!article) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className="flex h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800 lg:h-10 lg:border lg:border-gray-200 lg:px-3 dark:lg:border-gray-800"
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
            <p className="border-t pt-3 text-xs text-muted-foreground">
              {t('reviewedAt', { date: article.reviewedAt })}
            </p>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
