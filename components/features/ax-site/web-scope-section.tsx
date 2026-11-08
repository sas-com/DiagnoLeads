import { columnPath, columnsFor } from '@/lib/features/ax-site/columns';
import { ArrowRight, Building2, KeyRound, Network } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { AxCrossLink } from './ax-cross-link';
import { AxCtaLink } from './ax-cta-link';
import { EYEBROW, SECTION_HEADING, SECTION_LEAD, type SectionProps } from './landing-sections';
import { AX_SECTIONS } from './site-config';

/**
 * Where a web system can be reached from, and the four things to decide with it (#838, #840).
 * Moving to the web is not opening the system to the internet; how it is protected is decided
 * with the customer, and we keep fixing it after the move (owner, 2026-10-27). Never says that
 * the web makes a system safe (#296) and never offers a setup as a menu to pick (#464).
 */

const CARDS = [
  { key: 'now', icon: Building2 },
  { key: 'inside', icon: Network },
  { key: 'outside', icon: KeyRound },
] as const;

const DECIDE = ['reach', 'login', 'control', 'upkeep'] as const;

interface WebScopeProps extends SectionProps {
  /** Messages of the section (`axSite.webScope` or a page's own copy in its words) */
  namespace: string;
  /** Analytics location of the button */
  location: string;
  /** Column that explains the example in detail (Japanese only for now, #324) */
  columnSlug?: string;
}

export async function AxWebScope({ locale, namespace, location, columnSlug }: WebScopeProps) {
  const t = await getTranslations({ locale, namespace });
  const column = columnSlug
    ? columnsFor('access').find((item) => item.locale === locale && item.slug === columnSlug)
    : undefined;
  return (
    <section aria-labelledby="ax-web-scope-heading" className="bg-white py-16 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <p className={EYEBROW}>{t('eyebrow')}</p>
        <h2 id="ax-web-scope-heading" className={`mt-3 ${SECTION_HEADING}`}>
          {t('title')}
        </h2>
        <p className={SECTION_LEAD}>{t('lead')}</p>
        <ul className="mt-12 grid gap-6 md:grid-cols-3">
          {CARDS.map(({ key, icon: Icon }) => (
            <li
              key={key}
              className={key === 'now' ? 'bg-gray-100 p-6' : 'border border-ax-forest bg-white p-6'}
            >
              <p className="text-sm font-bold text-ax-leaf">{t(`cards.${key}.label`)}</p>
              <div className="mt-3 flex items-center gap-3">
                <Icon className="h-6 w-6 shrink-0 text-ax-forest" aria-hidden="true" />
                <h3 className="text-lg font-bold">{t(`cards.${key}.title`)}</h3>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-gray-700">{t(`cards.${key}.body`)}</p>
            </li>
          ))}
        </ul>
        <p className="mt-6 text-center text-sm leading-relaxed text-gray-700">{t('cardsNote')}</p>

        <div className="mx-auto mt-14 max-w-4xl bg-ax-cloud p-6 sm:p-10">
          <h3 className="text-center text-xl font-bold leading-snug sm:text-2xl">
            {t('decide.title')}
          </h3>
          <p className="mt-3 text-center text-sm leading-relaxed text-gray-700">
            {t('decide.lead')}
          </p>
          <ol className="mt-8 grid gap-6 sm:grid-cols-2">
            {DECIDE.map((key, index) => (
              <li key={key} className="flex gap-4">
                <span
                  aria-hidden="true"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ax-forest font-ax-latin text-sm font-bold text-white"
                >
                  {index + 1}
                </span>
                <div>
                  <p className="font-bold">{t(`decide.items.${key}.title`)}</p>
                  <p className="mt-1 text-sm leading-relaxed text-gray-700">
                    {t(`decide.items.${key}.body`)}
                  </p>
                </div>
              </li>
            ))}
          </ol>
          <p className="mt-8 border-t border-gray-300 pt-6 text-sm leading-relaxed">
            {t('itNote')}
          </p>
        </div>

        <p className="mt-10 text-center font-bold leading-relaxed">{t('closing')}</p>
        <div className="mt-6 text-center">
          <AxCtaLink href={`#${AX_SECTIONS.diagnosis}`} location={location}>
            {t('cta')}
          </AxCtaLink>
        </div>
        {column && (
          <p className="mt-8 text-center text-sm leading-relaxed text-gray-700">
            {t('columnLead')}
            <br />
            <AxCrossLink
              href={`/${column.locale}${columnPath(column.slug)}`}
              placement="web-scope"
              className="mt-1 inline-flex items-start gap-1 rounded py-1 font-bold leading-relaxed text-ax-leaf underline underline-offset-4 hover:text-ax-forest focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ax-forest"
            >
              {column.title}
              <ArrowRight className="mt-1.5 h-4 w-4 shrink-0" aria-hidden="true" />
            </AxCrossLink>
          </p>
        )}
      </div>
    </section>
  );
}
