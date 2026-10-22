import { AxCtaLink } from '@/components/features/ax-site/ax-cta-link';
import { AxSiteShell } from '@/components/features/ax-site/ax-site-shell';
import {
  ColumnBody,
  ColumnBreadcrumbs,
  ColumnToc,
  JsonLd,
  columnToc,
} from '@/components/features/ax-site/column-article';
import { AX_SITE_LINKS } from '@/components/features/ax-site/site-config';
import {
  COLUMNS,
  COLUMN_CTAS,
  COLUMN_INDEX_PATH,
  COLUMN_TRADEMARK_KEYS,
  type Column,
  columnDateTime,
  columnPath,
  formatColumnDate,
  getColumn,
  isColumnLocale,
} from '@/lib/features/ax-site/columns';
import {
  articleJsonLd,
  breadcrumbListJsonLd,
} from '@/lib/features/ax-site/columns/structured-data';
import { robotsFor, siteBaseUrl } from '@/lib/seo/indexing';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';

interface ColumnPageProps {
  params: Promise<{ locale: string; slug: string }>;
}

/** Articles exist in Japanese only; other locales and unknown slugs are 404 */
async function findColumn(params: ColumnPageProps['params']): Promise<Column> {
  const { locale, slug } = await params;
  const column = getColumn(slug);
  if (!isColumnLocale(locale) || !column || column.locale !== locale) notFound();
  return column;
}

export function generateStaticParams({ params }: { params: { locale: string } }) {
  return COLUMNS.filter((column) => column.locale === params.locale).map((column) => ({
    slug: column.slug,
  }));
}

export async function generateMetadata({ params }: ColumnPageProps): Promise<Metadata> {
  const column = await findColumn(params);
  const t = await getTranslations({ locale: column.locale, namespace: 'axColumn.meta' });
  const site = await getTranslations({ locale: column.locale, namespace: 'axSite.meta' });
  const title = t('articleTitle', { title: column.seoTitle, siteName: site('siteName') });
  const path = `/${column.locale}${columnPath(column.slug)}`;
  return {
    title: { absolute: title },
    description: column.description,
    // Japanese only: no alternate points at an English article that does not exist
    alternates: { canonical: path, languages: { [column.locale]: path } },
    authors: [{ name: site('siteName') }],
    creator: site('siteName'),
    keywords: null,
    // Replace the DiagnoLeads defaults of the public layout: this is the operator's own site
    openGraph: {
      type: 'article',
      title,
      description: column.description,
      siteName: site('siteName'),
      publishedTime: columnDateTime(column.publishedAt),
      modifiedTime: columnDateTime(column.updatedAt),
    },
    twitter: { card: 'summary', title, description: column.description },
    // Indexed only after public launch (test mode off, which needs the publication approval)
    robots: robotsFor(columnPath(column.slug)),
  };
}

/** Column article of the AX migration site (#324), ending with the diagnosis of its page */
export default async function ColumnPage({ params }: ColumnPageProps) {
  const column = await findColumn(params);
  const { locale } = column;
  const t = await getTranslations({ locale, namespace: 'axColumn' });
  const messages = await getTranslations({ locale });
  const site = await getTranslations({ locale, namespace: 'axSite' });
  const labels = { sources: t('sources'), newTab: site('footer.newTab') };
  const cta = COLUMN_CTAS[column.cta];

  const baseUrl = siteBaseUrl();
  const crumbs = [
    { name: t('breadcrumbHome'), path: `/${locale}/ax-migration` },
    { name: t('label'), path: `/${locale}${COLUMN_INDEX_PATH}` },
    { name: column.title, path: `/${locale}${columnPath(column.slug)}` },
  ];
  const url = `${baseUrl}${crumbs[2].path}`;

  return (
    <AxSiteShell locale={locale} variant="standalone">
      <JsonLd
        data={articleJsonLd(column, {
          url,
          operatorName: site('meta.siteName'),
          operatorUrl: AX_SITE_LINKS.operator,
        })}
      />
      <JsonLd
        data={breadcrumbListJsonLd(
          crumbs.map(({ name, path }) => ({ name, url: `${baseUrl}${path}` }))
        )}
      />
      <article className="bg-white">
        {/* About 40 Japanese characters a line: the width is in em of the article text */}
        <div className="mx-auto max-w-[40em] px-4 pb-16 pt-8 text-base sm:px-0 sm:pt-10 sm:text-[1.0625rem]">
          <ColumnBreadcrumbs
            // The last one is this page
            items={crumbs.map(({ name, path }, index) =>
              index < crumbs.length - 1 ? { name, href: path } : { name }
            )}
            label={t('breadcrumbLabel')}
          />
          <header className="mt-8">
            <p className="text-sm font-bold tracking-wider text-ax-teal-dark">{t('label')}</p>
            <h1 className="mt-2 text-[1.625rem] font-bold leading-snug sm:text-[2rem]">
              {column.title}
            </h1>
            <dl className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-sm text-gray-600">
              <div className="flex gap-2">
                <dt>{t('publishedAt')}</dt>
                <dd>
                  <time dateTime={column.publishedAt}>
                    {formatColumnDate(column.publishedAt, locale)}
                  </time>
                </dd>
              </div>
              <div className="flex gap-2">
                <dt>{t('updatedAt')}</dt>
                <dd>
                  <time dateTime={column.updatedAt}>
                    {formatColumnDate(column.updatedAt, locale)}
                  </time>
                </dd>
              </div>
            </dl>
          </header>
          <ColumnToc items={columnToc(column.blocks, t('sources'))} label={t('toc')} />
          <ColumnBody blocks={column.blocks} labels={labels} />

          <aside className="mt-14 rounded-3xl bg-ax-deep px-6 py-8 text-center text-white">
            <p className="font-bold leading-relaxed">{t('ctaLead')}</p>
            <AxCtaLink href={cta.href} tone="dark" location="column-end" className="mt-5">
              {messages(cta.labelKey)}
            </AxCtaLink>
          </aside>
          <p className="mt-10 text-xs leading-relaxed text-gray-600">
            {messages(COLUMN_TRADEMARK_KEYS[column.related])}
          </p>
        </div>
      </article>
    </AxSiteShell>
  );
}
