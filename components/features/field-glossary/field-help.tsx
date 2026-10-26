'use client';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { Info } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useFieldGlossary } from './use-field-glossary';

interface FieldHelpProps {
  /** The field key, e.g. 'leads.status' */
  fieldKey: string;
  /** When set, show help for this value of the field; otherwise the field's own help */
  value?: string;
  className?: string;
}

/**
 * An info icon placed next to an input label that opens a popover with the field's (or one of its
 * values') description from the site-wide glossary (Epic #780). Enum value labels live in locales/
 * (not the glossary), so the popover shows only the description. Renders nothing while loading or
 * when the glossary has no description for the field/value, so screens can place it
 * unconditionally.
 */
export function FieldHelp({ fieldKey, value, className }: FieldHelpProps) {
  const t = useTranslations('fieldGlossary');
  const locale = useLocale();
  const { field, entryFor, isLoading } = useFieldGlossary(fieldKey);
  const entry = value !== undefined ? entryFor(value) : field;
  const description =
    (locale === 'en' ? entry?.descriptionEn : entry?.descriptionJa) ??
    entry?.descriptionJa ??
    entry?.descriptionEn ??
    null;
  if (isLoading || !description) return null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t('help')}
          className={cn(
            'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-gray-400 transition-colors hover:text-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 dark:text-gray-500 dark:hover:text-gray-300',
            className
          )}
        >
          <Info className="h-4 w-4" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72">
        <p className="whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-300">
          {description}
        </p>
      </PopoverContent>
    </Popover>
  );
}
