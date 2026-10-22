import { AxSiteShell } from '@/components/features/ax-site/ax-site-shell';
import { ColumnBreadcrumbs, JsonLd } from '@/components/features/ax-site/column-article';
import {
  COLUMNS,
  COLUMN_INDEX_PATH,
  columnPath,
  formatColumnDate,
  isColumnLocale,
} from '@/lib/features/ax-site/columns';
import { breadcrumbListJsonLd } from '@/lib/features/ax-site/columns/structured-data';
import { robotsFor, siteBaseUrl } from '@/lib/seo/indexing';
import { ArrowRight } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';

interface ColumnIndexPageProps {
  params: Promise<{ locale: string }>;
}

/** Articles exist in Japanese only; the list of other locales is 404 */
async function columnLocale(params: ColumnIndexPageProps['params']) {
  const { locale } = await params;
  if (!isColumnLocale(locale)) notFound();
  return locale;
}

export async function generateMetadata({ params }: ColumnIndexPageProps): Promise<Metadata> {
  const locale = await columnLocale(params);
  const t = await getTranslations({ locale, namespace: 'axColumn.meta' });
  const site = await getTranslations({ locale, namespace: 'axSite.meta' });
  const path = `/${locale}${COLUMN_INDEX_PATH}`;
  return {
    title: { absolute: t('title') },
    description: t('description'),
    // Japanese only: no alternate points at an English list that does not exist
    alternates: { canonical: path, languages: { [locale]: path } },
    authors: [{ name: site('siteName') }],
    creator: site('siteName'),
    keywords: null,
    // Replace the DiagnoLeads defaults of the public layout: this is the operator's own site
    openGraph: {
      type: 'website',
      title: t('title'),
      description: t('description'),
      siteName: site('siteName'),
    },
    twitter: { card: 'summary', title: t('title'), description: t('description') },
    // Indexed only after public launch (test mode off, which needs the publication approval)
    robots: robotsFor(COLUMN_INDEX_PATH),
  };
}

/** List of the column articles of the AX migration site (#324), newest first */
export default async function ColumnIndexPage({ params }: ColumnIndexPageProps) {
  const locale = await columnLocale(params);
  const t = await getTranslations({ locale, namespace: 'axColumn' });
  const columns = COLUMNS.filter((column) => column.locale === locale);
  const baseUrl = siteBaseUrl();
  const crumbs = [
    { name: t('breadcrumbHome'), path: `/${locale}/ax-migration` },
    { name: t('label'), path: `/${locale}${COLUMN_INDEX_PATH}` },
  ];

  return (
    <AxSiteShell locale={locale} variant="standalone">
      <JsonLd
        data={breadcrumbListJsonLd(
          crumbs.map(({ name, path }) => ({ name, url: `${baseUrl}${path}` }))
        )}
      />
      <div className="bg-gradient-to-b from-white to-ax-mist">
        <div className="mx-auto max-w-3xl px-4 pb-16 pt-8 sm:px-6 sm:pt-10">
          <ColumnBreadcrumbs
            items={[{ name: crumbs[0].name, href: crumbs[0].path }, { name: crumbs[1].name }]}
            label={t('breadcrumbLabel')}
          />
          <h1 className="mt-8 text-[1.75rem] font-bold leading-snug sm:text-4xl">{t('title')}</h1>
          <p className="mt-4 leading-relaxed">{t('lead')}</p>
          <ul className="mt-10 space-y-5">
            {columns.map((column) => (
              <li key={column.slug}>
                <article className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-black/5 sm:p-8">
                  <p className="text-sm text-gray-600">
                    {t('publishedAt')}{' '}
                    <time dateTime={column.publishedAt}>
                      {formatColumnDate(column.publishedAt, locale)}
                    </time>
                  </p>
                  <h2 className="mt-2 text-lg font-bold leading-snug sm:text-xl">
                    <a
                      href={`/${locale}${columnPath(column.slug)}`}
                      className="hover:text-ax-teal-dark hover:underline hover:underline-offset-4"
                    >
                      {column.title}
                    </a>
                  </h2>
                  <p className="mt-3 text-sm leading-relaxed text-gray-700">{column.description}</p>
                  <p className="mt-4 flex items-center gap-1 text-sm font-bold text-ax-teal-dark">
                    <span aria-hidden="true">{t('readArticle')}</span>
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </p>
                </article>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </AxSiteShell>
  );
}
