'use client';

import { Command, CommandGroup, CommandItem, CommandList } from '@/components/ui/command';
import { useOrganization } from '@/hooks/use-organization';
import { LEAD_LIST_PARAMS } from '@/lib/features/leads/list-query';
import { trpc } from '@/lib/trpc/client';
import { RiSearchLine } from '@remixicon/react';
import { Command as CommandPrimitive } from 'cmdk';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

const SHOW_ALL_VALUE = '__show-all__';
const DEBOUNCE_MS = 200;

function useDebounced(value: string, delay: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/**
 * Header search box (#164): suggests leads of the current organization (name, email, company).
 * Arrow keys move through the suggestions and Enter opens the lead; Enter with nothing chosen
 * (the first row is "search the lead list") opens the lead list filtered by the text.
 */
export function HeaderLeadSearch() {
  const t = useTranslations('header.search');
  const locale = useLocale();
  const router = useRouter();
  const { organizationId } = useOrganization();

  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(SHOW_ALL_VALUE);
  const query = text.trim();
  const debouncedQuery = useDebounced(query, DEBOUNCE_MS);

  const suggestions = trpc.leadSearch.suggest.useQuery(
    { organizationId: organizationId ?? '', query: debouncedQuery },
    { enabled: Boolean(organizationId) && debouncedQuery.length > 0, staleTime: 30_000 }
  );
  const leads = debouncedQuery.length > 0 ? (suggestions.data ?? []) : [];
  const searching = query !== debouncedQuery || suggestions.isFetching;
  const showList = open && query.length > 0;

  const close = () => {
    setOpen(false);
    setSelected(SHOW_ALL_VALUE);
  };

  const goToList = () => {
    if (!query) return;
    close();
    router.push(`/${locale}/leads?${LEAD_LIST_PARAMS.search}=${encodeURIComponent(query)}`);
  };

  const goToLead = (leadId: string) => {
    close();
    setText('');
    router.push(`/${locale}/leads/${leadId}`);
  };

  return (
    <Command
      shouldFilter={false}
      loop
      value={selected}
      onValueChange={setSelected}
      label={t('label')}
      className="relative overflow-visible bg-transparent dark:bg-transparent"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          close();
          return;
        }
        // Enter on an empty list (nothing to choose yet): still search the list
        if (event.key === 'Enter' && !showList) goToList();
      }}
    >
      <div className="relative">
        <span className="absolute -translate-y-1/2 left-4 top-1/2 pointer-events-none">
          <RiSearchLine aria-hidden="true" className="w-5 h-5 text-gray-400 dark:text-gray-500" />
        </span>
        <CommandPrimitive.Input
          value={text}
          onValueChange={(value) => {
            setText(value);
            setSelected(SHOW_ALL_VALUE);
            setOpen(value.trim().length > 0);
          }}
          onFocus={() => setOpen(query.length > 0)}
          onBlur={close}
          placeholder={t('placeholder')}
          aria-label={t('label')}
          className="h-11 w-full rounded-lg border border-gray-200 bg-gray-50 py-2.5 pl-12 pr-4 text-sm text-gray-800 placeholder:text-gray-400 focus:border-brand-300 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:bg-white dark:border-gray-700 dark:bg-gray-800 dark:text-white/90 dark:placeholder:text-gray-500 dark:focus:border-brand-600 dark:focus:bg-gray-800 xl:w-[320px] transition-all"
        />
      </div>
      {/* Always mounted (cmdk 1.0 needs its list to exist), shown while there is text */}
      <div
        hidden={!showList}
        className="absolute left-0 top-full z-50 mt-1 w-full min-w-[320px] rounded-md border border-gray-200 bg-white shadow-md dark:border-gray-800 dark:bg-gray-950"
        // Keep the focus in the box so choosing with the mouse does not close the list first
        onMouseDown={(event) => event.preventDefault()}
      >
        <CommandList>
          {showList && (
            <>
              <CommandGroup>
                <CommandItem value={SHOW_ALL_VALUE} onSelect={goToList}>
                  <RiSearchLine aria-hidden="true" />
                  <span className="truncate">{t('showAll', { query })}</span>
                </CommandItem>
              </CommandGroup>
              {searching && leads.length === 0 ? (
                <p className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">
                  {t('searching')}
                </p>
              ) : leads.length === 0 ? (
                <p className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">{t('empty')}</p>
              ) : (
                <CommandGroup heading={t('suggestions')}>
                  {leads.map((lead) => (
                    <CommandItem key={lead.id} value={lead.id} onSelect={() => goToLead(lead.id)}>
                      <div className="min-w-0">
                        <p className="truncate font-medium">
                          {lead.name || t('noName')}
                          {lead.company && (
                            <span className="ml-2 font-normal text-gray-500 dark:text-gray-400">
                              {lead.company}
                            </span>
                          )}
                        </p>
                        <p className="truncate text-xs text-gray-500 dark:text-gray-400">
                          {lead.email}
                        </p>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </>
          )}
        </CommandList>
      </div>
    </Command>
  );
}
