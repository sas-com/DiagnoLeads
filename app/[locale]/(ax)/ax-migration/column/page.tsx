import { AxSiteShell } from '@/components/features/ax-site/ax-site-shell';
import { ColumnBreadcrumbs, JsonLd } from '@/components/features/ax-site/column-article';
import { ColumnThumbnail } from '@/components/features/ax-site/column-thumbnail';
import {
  COLUMNS,
  COLUMN_INDEX_PATH,
  columnPath,
  formatColumnDate,
  isColumnLocale,
} from '@/lib/features/ax-site/columns';
import { breadcrumbListJsonLd } from '@/lib/features/ax-site/columns/structured-data';
import { axShareImage } from '@/lib/features/ax-site/share-images';
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
  const list = await getTranslations({ locale, namespace: 'axColumn' });
  // Share image (#344): the lead of the list, also its alt text
  const image = axShareImage('ax-column', locale, list('lead'));
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
      images: [image],
    },
    twitter: {
      card: 'summary_large_image',
      title: t('title'),
      description: t('description'),
      images: [image],
    },
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
                {/*
                  The whole card leads to the article (#344) through the one link of the title,
                  stretched over the card: the image and "read the article" are not second links,
                  so a screen reader announces each article once. The card shows the focus.
                */}
                {/*
                  A grid (#347): on phones a small image beside the date and the title, and the
                  summary across the card below them, so that a screen shows several articles; from
                  sm the image on the left of all of it
                */}
                <article className="relative grid grid-cols-[6rem_minmax(0,1fr)] gap-x-4 gap-y-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5 focus-within:outline focus-within:outline-3 focus-within:outline-offset-2 focus-within:outline-ax-teal-dark sm:grid-cols-[15rem_minmax(0,1fr)] sm:gap-x-6 sm:p-6">
                  {/* Decorative: the link below names the article; not a second link to it */}
                  <ColumnThumbnail
                    slug={column.slug}
                    sizes="(min-width: 640px) 240px, 96px"
                    className="self-start rounded-lg sm:row-span-3 sm:rounded-xl"
                  />
                  <div>
                    <p className="text-sm text-gray-600">
                      {t('publishedAt')}{' '}
                      <time dateTime={column.publishedAt}>
                        {formatColumnDate(column.publishedAt, locale)}
                      </time>
                    </p>
                    <h2 className="mt-1 text-base font-bold leading-snug sm:mt-2 sm:text-xl">
                      <a
                        href={`/${locale}${columnPath(column.slug)}`}
                        className="outline-none after:absolute after:inset-0 after:rounded-2xl after:content-[''] hover:text-ax-teal-dark hover:underline hover:underline-offset-4"
                      >
                        {column.title}
                      </a>
                    </h2>
                  </div>
                  <p className="col-span-2 text-sm leading-relaxed text-gray-700 sm:col-span-1 sm:col-start-2">
                    {column.description}
                  </p>
                  <p className="col-span-2 flex items-center gap-1 text-sm font-bold text-ax-teal-dark sm:col-span-1 sm:col-start-2">
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
