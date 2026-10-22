/**
 * Column pages of the AX migration site (#324): the renderer, the list and article pages
 * (server components rendered with the real messages) and the link from the Access page
 */
import { ColumnBody } from '@/components/features/ax-site/column-article';
import type { ColumnBlock } from '@/lib/features/ax-site/columns';
import messages from '@/locales/ja/common.json';
import { render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider, createTranslator } from 'next-intl';
import { type ReactElement, type ReactNode, cloneElement, isValidElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next-intl/server', () => ({
  getTranslations: async ({ locale, namespace }: { locale: string; namespace?: string }) =>
    createTranslator({ locale, messages, namespace: namespace as never }),
}));
// The real notFound() (test/setup.ts mocks the hooks of next/navigation only)
vi.mock('next/navigation', async () => {
  const { notFound } = await vi.importActual<typeof import('next/navigation')>('next/navigation');
  return { notFound, usePathname: () => '/', useSearchParams: () => new URLSearchParams() };
});
vi.mock('next/font/google', () => ({
  Noto_Sans_JP: () => ({ variable: 'font-noto' }),
  Lato: () => ({ variable: 'font-lato' }),
}));

const { default: ColumnPage, generateMetadata } = await import(
  '@/app/[locale]/(ax)/ax-migration/column/[slug]/page'
);
const { default: ColumnIndexPage, generateMetadata: generateIndexMetadata } = await import(
  '@/app/[locale]/(ax)/ax-migration/column/page'
);
const { default: AxAccessPage } = await import('@/app/[locale]/(ax)/ax-migration/access/page');

afterEach(() => {
  vi.unstubAllEnvs();
});

/** Resolve nested async server components first, then render the plain tree */
async function resolveServerTree(node: ReactNode): Promise<ReactNode> {
  if (Array.isArray(node)) return Promise.all(node.map(resolveServerTree));
  if (!isValidElement(node)) return node;
  const element = node as ReactElement<{ children?: ReactNode }>;
  const { type } = element;
  if (typeof type === 'function' && type.constructor.name === 'AsyncFunction') {
    return resolveServerTree(await (type as (props: unknown) => Promise<ReactNode>)(element.props));
  }
  if (element.props.children === undefined) return element;
  const children = await resolveServerTree(element.props.children);
  return cloneElement(element, undefined, ...(Array.isArray(children) ? children : [children]));
}

const withIntl = (ui: ReactNode) => (
  <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
    {ui}
  </NextIntlClientProvider>
);

const slug = 'access-office-support-end';
const articleParams = (locale = 'ja', s = slug) => ({ params: Promise.resolve({ locale, slug: s }) });
const labels = { sources: '出典', newTab: '（新しいタブで開きます）' };

const jsonLd = (container: HTMLElement) =>
  [...container.querySelectorAll('script[type="application/ld+json"]')].map((script) =>
    JSON.parse(script.textContent ?? '')
  );

/** notFound() throws the 404 error Next.js renders as the not-found page */
const NOT_FOUND = { digest: expect.stringContaining('404') };

describe('column renderer', () => {
  const blocks: ColumnBlock[] = [
    { type: 'h2', id: 'first', text: '見出し' },
    { type: 'h3', id: 'second', text: '小見出し' },
    {
      type: 'p',
      content: [
        { type: 'text', text: '<script>alert(1)</script><img src=x onerror=alert(1)>' },
        { type: 'strong', text: '<b>太字</b>' },
        { type: 'link', text: '中のリンク', href: '/ja/ax-migration/access#diagnosis' },
        { type: 'link', text: '外のリンク', href: 'https://learn.microsoft.com/' },
        { type: 'link', text: '危ないリンク', href: 'javascript:alert(1)' },
      ],
    },
    { type: 'table', header: ['版', '状況'], rows: [['Access 2016', '終了']] },
    { type: 'callout', content: '注記です' },
    {
      type: 'sources',
      items: [{ title: '出典ページ', href: 'https://support.microsoft.com/' }],
      notes: ['注'],
    },
  ];

  it('renders headings with ids, a table with a header row and the sources', () => {
    const { container } = render(<ColumnBody blocks={blocks} labels={labels} />);
    expect(screen.getByRole('heading', { level: 2, name: '見出し' })).toHaveAttribute('id', 'first');
    expect(screen.getByRole('heading', { level: 3, name: '小見出し' })).toHaveAttribute(
      'id',
      'second'
    );
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('columnheader').map((th) => th.textContent)).toEqual([
      '版',
      '状況',
    ]);
    expect(within(table).getByRole('rowheader', { name: 'Access 2016' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '出典' })).toHaveAttribute('id', 'sources');
    expect(container.querySelector('aside')).toHaveTextContent('注記です');
  });

  it('opens outside links in a new tab without the opener, and site links in place', () => {
    render(<ColumnBody blocks={blocks} labels={labels} />);
    const inside = screen.getByRole('link', { name: '中のリンク' });
    expect(inside).toHaveAttribute('href', '/ja/ax-migration/access#diagnosis');
    expect(inside).not.toHaveAttribute('target');
    for (const name of [/外のリンク/, /出典ページ/]) {
      const outside = screen.getByRole('link', { name });
      expect(outside).toHaveAttribute('target', '_blank');
      expect(outside).toHaveAttribute('rel', 'noopener noreferrer');
      expect(outside).toHaveAccessibleName(expect.stringContaining('新しいタブ'));
    }
    // A refused link is only its text
    expect(screen.queryByRole('link', { name: '危ないリンク' })).toBeNull();
    expect(screen.getByText('危ないリンク')).toBeInTheDocument();
  });

  it('shows markup in the text as text', () => {
    const { container } = render(<ColumnBody blocks={blocks} labels={labels} />);
    expect(container.querySelector('script, img, b')).toBeNull();
    expect(container).toHaveTextContent('<script>alert(1)</script><img src=x onerror=alert(1)>');
    expect(container).toHaveTextContent('<b>太字</b>');
  });
});

describe('column article page', () => {
  it('renders the article with breadcrumbs, contents, dates, the CTA and the trademark', async () => {
    const { container } = render(withIntl(await resolveServerTree(await ColumnPage(articleParams()))));

    expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual([
      'Access 2016・2019・2021 のサポート終了：使い続けるとどうなり、何をすればよいか',
    ]);
    const crumbs = within(screen.getByRole('navigation', { name: 'パンくずリスト' }));
    expect(crumbs.getByRole('link', { name: 'AXマイグレーション' })).toHaveAttribute(
      'href',
      '/ja/ax-migration'
    );
    expect(crumbs.getByRole('link', { name: 'コラム' })).toHaveAttribute(
      'href',
      '/ja/ax-migration/column'
    );

    // Every entry of the contents leads to a heading of the page
    const toc = within(screen.getByRole('navigation', { name: '目次' }));
    const entries = toc.getAllByRole('link');
    expect(entries.map((link) => link.textContent)).toContain('お使いの版と、サポートの状況');
    expect(entries.at(-1)).toHaveTextContent('出典');
    for (const link of entries) {
      const id = link.getAttribute('href')?.slice(1) ?? '';
      expect(document.getElementById(id)?.tagName).toBe('H2');
    }

    expect(screen.getByText('公開日')).toBeInTheDocument();
    expect(screen.getAllByText('2026年10月22日')).toHaveLength(2);
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByText(/日付を米国太平洋時間で表記しています/)).toBeInTheDocument();

    // The closing link of the text and the CTA both lead to the Access diagnosis
    expect(screen.getByRole('link', { name: '無料Web診断（Access版）を見る' })).toHaveAttribute(
      'href',
      '/ja/ax-migration/access#diagnosis'
    );
    expect(screen.getByRole('link', { name: '無料Web診断（Access版）をはじめる' })).toHaveAttribute(
      'href',
      '/ja/ax-migration/access#diagnosis'
    );
    expect(
      screen.getByText(
        'Microsoft、Access は、米国 Microsoft Corporation の米国およびその他の国における商標または登録商標です。'
      )
    ).toBeInTheDocument();

    const [article, breadcrumbs] = jsonLd(container);
    expect(article).toMatchObject({
      '@type': 'Article',
      headline: 'Access 2016・2019・2021 のサポート終了：使い続けるとどうなり、何をすればよいか',
      datePublished: '2026-10-22T00:00:00+09:00',
      publisher: { name: 'エス・エー・エス株式会社' },
    });
    expect(article.url).toMatch(/\/ja\/ax-migration\/column\/access-office-support-end$/);
    expect(article.image).toMatchObject({ width: 1200, height: 630 });
    expect(article.image.url).toMatch(
      /^https?:\/\/[^/]+\/images\/columns\/access-office-support-end\.png$/
    );
    expect(breadcrumbs.itemListElement.map((item: { name: string }) => item.name)).toEqual([
      'AXマイグレーション',
      'コラム',
      'Access 2016・2019・2021 のサポート終了：使い続けるとどうなり、何をすればよいか',
    ]);
  });

  it('shows its title card above the heading, decorative and through the image optimizer', async () => {
    const { container } = render(
      withIntl(await resolveServerTree(await ColumnPage(articleParams())))
    );
    const header = container.querySelector('article header') as HTMLElement;
    const image = header.querySelector('img') as HTMLImageElement;
    // Empty alt: the h1 right below says the same
    expect(image).toHaveAttribute('alt', '');
    expect(screen.queryByRole('img')).toBeNull();
    expect(image).toHaveAttribute('width', '1200');
    expect(image).toHaveAttribute('height', '630');
    expect(decodeURIComponent(image.getAttribute('src') ?? '')).toContain(
      '/images/columns/access-office-support-end.png'
    );
    // Before the heading, loaded early (preload: not lazy)
    expect(
      image.compareDocumentPosition(screen.getByRole('heading', { level: 1 })) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(image).not.toHaveAttribute('loading', 'lazy');
  });

  it('shares the title card with an absolute URL on Open Graph and X', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://example.jp');
    const metadata = await generateMetadata(articleParams('ja', 'access-2gb-limit'));
    const image = {
      url: 'https://example.jp/images/columns/access-2gb-limit.png',
      width: 1200,
      height: 630,
      alt: 'Access の 2GB の上限に近づいたら',
    };
    expect(metadata.openGraph?.images).toEqual([image]);
    expect(metadata.twitter).toMatchObject({ card: 'summary_large_image', images: [image] });
  });

  it('shows the trademark notice of an article that names more products, instead of the page one', async () => {
    render(withIntl(await resolveServerTree(await ColumnPage(articleParams('ja', 'access-shared-folder')))));
    expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual([
      '共有フォルダの Access を何人かで使うと起きること',
    ]);
    expect(
      screen.getByText(
        'Microsoft、Access、SQL Server、OneDrive、SharePoint は、米国 Microsoft Corporation の米国およびその他の国における商標または登録商標です。'
      )
    ).toBeInTheDocument();
    expect(screen.queryByText(/^Microsoft、Access は、/)).toBeNull();
    // A path in the text stays text, backslashes included
    expect(screen.getByText('\\\\サーバー名\\フォルダ名').tagName).toBe('CODE');
  });

  it('has the article metadata, its own canonical address and no index in test mode', async () => {
    vi.stubEnv('APP_TEST_MODE', 'true');
    const metadata = await generateMetadata(articleParams());
    expect(metadata.title).toEqual({
      absolute: 'Access 2021などのサポート終了、使い続けるとどうなる？｜エス・エー・エス株式会社',
    });
    expect(metadata.description).toMatch(/^Access 2016・2019は2025年10月/);
    expect(metadata.alternates).toEqual({
      canonical: '/ja/ax-migration/column/access-office-support-end',
      // No English article: no alternate points at one
      languages: { ja: '/ja/ax-migration/column/access-office-support-end' },
    });
    expect(metadata.openGraph).toMatchObject({
      type: 'article',
      siteName: 'エス・エー・エス株式会社',
      publishedTime: '2026-10-22T00:00:00+09:00',
      modifiedTime: '2026-10-22T00:00:00+09:00',
    });
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it('is indexed after public launch', async () => {
    vi.stubEnv('APP_TEST_MODE', 'false');
    expect((await generateMetadata(articleParams())).robots).toEqual({ index: true, follow: true });
  });

  it('answers 404 for an unknown slug and for English', async () => {
    await expect(ColumnPage(articleParams('ja', 'no-such-article'))).rejects.toMatchObject(NOT_FOUND);
    await expect(generateMetadata(articleParams('ja', 'no-such-article'))).rejects.toMatchObject(
      NOT_FOUND
    );
    await expect(ColumnPage(articleParams('en'))).rejects.toMatchObject(NOT_FOUND);
  });

  it('is rendered per request like the other AX pages (the shell reads the CSP nonce)', async () => {
    const page = await import('@/app/[locale]/(ax)/ax-migration/column/[slug]/page');
    expect('generateStaticParams' in page).toBe(false);
  });
});

describe('column list page', () => {
  const params = (locale = 'ja') => ({ params: Promise.resolve({ locale }) });

  it('lists the articles with a link and the date', async () => {
    const { container } = render(withIntl(await resolveServerTree(await ColumnIndexPage(params()))));
    expect(screen.getByRole('heading', { level: 1, name: 'コラム' })).toBeInTheDocument();
    expect(
      screen.getByRole('link', {
        name: 'Access 2016・2019・2021 のサポート終了：使い続けるとどうなり、何をすればよいか',
      })
    ).toHaveAttribute('href', '/ja/ax-migration/column/access-office-support-end');
    // Every article, in reading order
    expect(
      screen
        .getAllByRole('heading', { level: 2 })
        .map((heading) => within(heading).getByRole('link').getAttribute('href'))
    ).toEqual([
      '/ja/ax-migration/column/access-office-support-end',
      '/ja/ax-migration/column/access-fix-or-web',
      '/ja/ax-migration/column/access-shared-folder',
      '/ja/ax-migration/column/access-accde-only',
      '/ja/ax-migration/column/access-2gb-limit',
    ]);
    expect(screen.getAllByText('2026年10月22日')).toHaveLength(5);
    expect(jsonLd(container)[0]['@type']).toBe('BreadcrumbList');

    // Each card shows its title card, decorative: the link of the card stays the title
    const cards = [...container.querySelectorAll('li > article')];
    expect(cards).toHaveLength(5);
    expect(
      cards.map((card) => {
        const image = card.querySelector('img');
        expect(image).toHaveAttribute('alt', '');
        expect(within(card as HTMLElement).getAllByRole('link')).toHaveLength(1);
        return decodeURIComponent(image?.getAttribute('src') ?? '').match(
          /\/images\/columns\/([a-z0-9-]+)\.png/
        )?.[1];
      })
    ).toEqual([
      'access-office-support-end',
      'access-fix-or-web',
      'access-shared-folder',
      'access-accde-only',
      'access-2gb-limit',
    ]);
  });

  it('has its metadata and answers 404 in English', async () => {
    vi.stubEnv('APP_TEST_MODE', 'true');
    const metadata = await generateIndexMetadata(params());
    expect(metadata.alternates).toEqual({
      canonical: '/ja/ax-migration/column',
      languages: { ja: '/ja/ax-migration/column' },
    });
    expect(metadata.robots).toEqual({ index: false, follow: false });
    await expect(ColumnIndexPage(params('en'))).rejects.toMatchObject(NOT_FOUND);
  });

  it('shares a large image of its lead with an absolute URL (#344)', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://example.jp');
    const image = {
      url: 'https://example.jp/images/og/ax-column-ja.png',
      width: 1200,
      height: 630,
      alt: '基幹システムや業務ツールの移行を考えるときに知っておきたいことを、公開情報をもとに整理しています。',
    };
    const metadata = await generateIndexMetadata(params());
    expect(metadata.openGraph).toMatchObject({
      type: 'website',
      siteName: 'エス・エー・エス株式会社',
      images: [image],
    });
    expect(metadata.twitter).toMatchObject({ card: 'summary_large_image', images: [image] });
  });

  it('makes the whole card lead to the article through its one title link (#344)', async () => {
    const { container } = render(withIntl(await resolveServerTree(await ColumnIndexPage(params()))));
    for (const card of container.querySelectorAll<HTMLElement>('li > article')) {
      // One link, the title: the image and "read the article" are not links of their own
      const links = within(card).getAllByRole('link');
      expect(links).toHaveLength(1);
      const [link] = links;
      expect(link.closest('h2')).not.toBeNull();
      expect(link).toHaveAccessibleName(card.querySelector('h2')?.textContent ?? '');
      // The link is stretched over the card, which is its positioning box and shows the focus
      expect(link.className).toContain('after:absolute');
      expect(link.className).toContain('after:inset-0');
      expect(card.className).toContain('relative');
      expect(card.className).toMatch(/focus-within:outline-ax-teal-dark/);
      // No element between the card and the link creates another positioning box
      let node = link.parentElement;
      while (node && node !== card) {
        expect(node.className).not.toMatch(/\b(relative|absolute|fixed|sticky)\b/);
        node = node.parentElement;
      }
      expect(card.querySelector('img')).toHaveAttribute('alt', '');
      // "Read the article" is hidden from screen readers: the title already names the article
      expect(within(card).getByText('記事を読む')).toHaveAttribute('aria-hidden', 'true');
    }
  });
});

describe('Access landing page', () => {
  it('links the support-end section to the related column', async () => {
    render(
      withIntl(
        await resolveServerTree(await AxAccessPage({ params: Promise.resolve({ locale: 'ja' }) }))
      )
    );
    const section = screen
      .getByRole('heading', { level: 2, name: 'Access のサポート終了' })
      .closest('section') as HTMLElement;
    expect(within(section).getByText('関連コラム')).toBeInTheDocument();
    expect(
      within(section).getByRole('link', { name: /Access 2016・2019・2021 のサポート終了/ })
    ).toHaveAttribute('href', '/ja/ax-migration/column/access-office-support-end');
    // Only the support-end article there; the others are on the column list
    expect(
      within(section)
        .getAllByRole('link')
        .filter((link) => link.getAttribute('href')?.includes('/column/'))
    ).toHaveLength(1);
  });
});
