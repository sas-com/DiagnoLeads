'use client';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { AlertCircle, RotateCw } from 'lucide-react';
import { useTranslations } from 'next-intl';

interface InlineLoadErrorProps {
  /** Asks again; without it there is no retry button */
  onRetry?: () => void;
  className?: string;
}

/**
 * Inline error where a list or a card's content would be, so a failed request never reads as
 * "nothing to show" (#431). Looks like the dashboard's CardError.
 */
export function InlineLoadError({ onRetry, className }: InlineLoadErrorProps) {
  const t = useTranslations('common');
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-wrap items-center justify-center gap-3 rounded-lg bg-rose-50 px-4 py-4 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300',
        className
      )}
    >
      <span className="inline-flex items-center gap-1.5">
        <AlertCircle className="h-4 w-4" aria-hidden="true" />
        {t('loadError')}
      </span>
      {onRetry && (
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          <RotateCw aria-hidden="true" />
          {t('retry')}
        </Button>
      )}
    </div>
  );
}
