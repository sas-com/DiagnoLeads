/**
 * Links between the main landing page, the Access landing page and the columns (#332): the
 * Access card, the Access page's links, the footer, the column header and the events they send.
 * Server components rendered with the real messages.
 */
import { setAxDiagnosisEntry, trackAxEvent } from '@/components/features/ax-diagnosis/tracking';
import { AxSiteFooter } from '@/components/features/ax-site/ax-site-footer';
import { COLUMNS } from '@/lib/features/ax-site/columns';
import enMessages from '@/locales/en/common.json';
import messages from '@/locales/ja/common.json';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider, createTranslator } from 'next-intl';
import { type ReactElement, type ReactNode, cloneElement, isValidElement } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next-intl/server', () => ({
  getTranslations: async ({ locale, namespace }: { locale: string; namespace?: string }) =>
    createTranslator({
      locale,
      messages: locale === 'en' ? enMessages : messages,
      namespace: namespace as never,
    }),
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

const { default: AxMigrationPage } = await import('@/app/[locale]/(ax)/ax-migration/page');
const { default: AxAccessPage } = await import('@/app/[locale]/(ax)/ax-migration/access/page');
const { default: ColumnPage } = await import(
  '@/app/[locale]/(ax)/ax-migration/column/[slug]/page'
);

type AnalyticsWindow = Window & { dataLayer?: unknown[]; gtag?: unknown };

/** Events pushed to the data layer, by name */
const events = (name: string) =>
  ((window as AnalyticsWindow).dataLayer ?? []).filter(
    (entry): entry is Record<string, unknown> =>
      typeof entry === 'object' && entry !== null && (entry as { event?: unknown }).event === name
  );

/** jsdom does not navigate; the address a click opens is the link's href after the click */
const stopNavigation = (event: MouseEvent) => event.preventDefault();

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  window.scrollTo = vi.fn() as typeof window.scrollTo;
});

beforeEach(() => {
  const w = window as AnalyticsWindow;
  w.gtag = undefined;
  w.dataLayer = [];
  document.addEventListener('click', stopNavigation);
  window.localStorage.clear();
});

afterEach(() => {
  document.removeEventListener('click', stopNavigation);
  (window as AnalyticsWindow).dataLayer = undefined;
  setAxDiagnosisEntry(undefined);
  vi.unstubAllEnvs();
  window.history.replaceState(null, '', '/');
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

const withIntl = (ui: ReactNode, locale = 'ja') => (
  <NextIntlClientProvider
    locale={locale}
    messages={locale === 'en' ? enMessages : messages}
    timeZone="Asia/Tokyo"
  >
    {ui}
  </NextIntlClientProvider>
);

const params = (locale = 'ja') => ({ params: Promise.resolve({ locale }) });
const renderMain = async () =>
  render(withIntl(await resolveServerTree(await AxMigrationPage(params()))));
const renderAccess = async (locale = 'ja') =>
  render(withIntl(await resolveServerTree(await AxAccessPage(params(locale))), locale));
const renderColumn = async (slug: string) =>
  render(
    withIntl(
      await resolveServerTree(
        await ColumnPage({ params: Promise.resolve({ locale: 'ja', slug }) })
      )
    )
  );

const siteNav = () => within(screen.getByRole('navigation', { name: 'サイト内のページ' }));
const accessCard = () =>
  within(
    screen.getByRole('heading', { level: 3, name: 'Microsoft Access' }).closest('li') as HTMLElement
  );

describe('Access card of the main landing page', () => {
  it('starts the embedded diagnosis on the Access questions from its button', async () => {
    window.history.replaceState(null, '', '/ja/ax-migration');
    const user = userEvent.setup();
    await renderMain();

    const button = accessCard().getByRole('link', { name: 'Accessの質問から無料Web診断をはじめる' });
    expect(button).toHaveAttribute('href', '#diagnosis');
    await user.click(button);

    const diagnosis = within(document.getElementById('diagnosis') as HTMLElement);
    expect(diagnosis.getByRole('group', { name: /直せる（変更できる）人/ })).toBeInTheDocument();
    expect(events('ax_lp_cta_click')).toEqual([
      { event: 'ax_lp_cta_click', cta: 'diagnosis', location: 'targets-access', page: 'ax-lp' },
    ]);
    // Inside the page: no move between pages
    expect(events('ax_cross_link_click')).toEqual([]);
  });

  it('links to the Access landing page with a text link, measured as a cross link', async () => {
    window.history.replaceState(null, '', '/ja/ax-migration?utm_source=google&utm_campaign=ax');
    const user = userEvent.setup();
    await renderMain();

    const link = accessCard().getByRole('link', {
      name: 'Access の3つの道（直す・Web に移す・置き換える）を詳しく見る',
    });
    // Without JavaScript the plain path works
    expect(link).toHaveAttribute('href', '/ja/ax-migration/access');
    await user.click(link);

    expect(link).toHaveAttribute(
      'href',
      '/ja/ax-migration/access?utm_source=google&utm_campaign=ax&from=ax-lp-targets-access'
    );
    expect(events('ax_cross_link_click')).toEqual([
      {
        event: 'ax_cross_link_click',
        from_page: 'ax-lp',
        to_page: 'ax-access-lp',
        location: 'targets-access',
      },
    ]);
  });
});

describe('Access landing page links', () => {
  it('shows where the page is, with a link to the main page', async () => {
    await renderAccess();
    const crumbs = within(screen.getByRole('navigation', { name: 'パンくずリスト' }));
    expect(crumbs.getByRole('link', { name: 'AXマイグレーション' })).toHaveAttribute(
      'href',
      '/ja/ax-migration'
    );
    expect(crumbs.getByText('Microsoft Access の移行')).toHaveAttribute('aria-current', 'page');
  });

  it('names the logo after where it leads (the top of this page)', async () => {
    await renderAccess();
    const banner = within(screen.getByRole('banner'));
    expect(banner.getByRole('link', { name: 'このページの先頭へ' })).toHaveAttribute('href', '#top');
  });

  it('leads readers of AS/400 and ACOS to the main page sections', async () => {
    window.history.replaceState(null, '', '/ja/ax-migration/access');
    const user = userEvent.setup();
    await renderAccess();

    const hosts = within(
      screen.getByRole('region', { name: 'AS/400・ACOS など基幹システムの移行をお考えの方へ' })
    );
    const links = hosts.getAllByRole('link');
    expect(links.map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['AS/400（IBM i）からの移行について読む', '/ja/ax-migration#as400-migration'],
      ['NEC ACOS からの移行について読む', '/ja/ax-migration#acos-migration'],
      ['対象となるシステムの一覧を見る', '/ja/ax-migration#targets'],
    ]);

    for (const link of links) await user.click(link);
    expect(links[1]).toHaveAttribute('href', '/ja/ax-migration?from=ax-access-lp-hosts#acos-migration');
    // The three links are told apart by the section they open
    expect(events('ax_cross_link_click')).toEqual(
      ['as400-migration', 'acos-migration', 'targets'].map((to_section) => ({
        event: 'ax_cross_link_click',
        from_page: 'ax-access-lp',
        to_page: 'ax-lp',
        location: 'hosts',
        to_section,
      }))
    );
  });

  it('leads readers who cannot tell their files apart to the file types column (#367)', async () => {
    window.history.replaceState(null, '', '/ja/ax-migration/access');
    const user = userEvent.setup();
    await renderAccess();

    const targets = within(screen.getByRole('region', { name: '対象になる Access' }));
    const link = targets.getByRole('link', { name: 'Access のファイルか分からない方へ：拡張子での見分け方' });
    expect(link).toHaveAttribute('href', '/ja/ax-migration/column/access-file-types');

    await user.click(link);
    expect(link).toHaveAttribute(
      'href',
      '/ja/ax-migration/column/access-file-types?from=ax-access-lp-targets'
    );
    expect(events('ax_cross_link_click')).toEqual([
      {
        event: 'ax_cross_link_click',
        from_page: 'ax-access-lp',
        to_page: 'ax-column',
        location: 'targets',
      },
    ]);
  });

  it('links the table of the three ways after their section', async () => {
    await renderAccess();
    const pathsHeading = screen.getByRole('heading', { level: 2, name: '進め方は、3つあります' });
    // The first of two: the related columns after the questions list it again
    const [link] = screen.getAllByRole('link', {
      name: 'Access を直すか、Web に移すか：判断の目安を表で整理する',
    });
    expect(link).toHaveAttribute('href', '/ja/ax-migration/column/access-fix-or-web');
    expect(pathsHeading.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      link.compareDocumentPosition(screen.getByRole('heading', { level: 2, name: '無料Web診断からの流れ' })) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('lists the Access columns and the column list after the questions', async () => {
    window.history.replaceState(null, '', '/ja/ax-migration/access');
    const user = userEvent.setup();
    await renderAccess();

    const section = screen.getByRole('region', { name: 'Access の移行に関するコラム' });
    const faq = screen.getByRole('heading', { level: 2, name: 'よくある質問' });
    expect(faq.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const links = within(section).getAllByRole('link');
    const access = COLUMNS.filter((column) => column.related === 'access');
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      ...access.map((column) => `/ja/ax-migration/column/${column.slug}`),
      '/ja/ax-migration/column',
    ]);
    expect(links.map((link) => link.textContent)).toEqual([
      ...access.map((column) => column.title),
      'コラムの一覧を見る',
    ]);

    await user.click(links.at(-1) as HTMLElement);
    expect(events('ax_cross_link_click')).toEqual([
      {
        event: 'ax_cross_link_click',
        from_page: 'ax-access-lp',
        to_page: 'ax-column-index',
        location: 'related',
      },
    ]);
  });

  it('says other systems can be chosen with the back button', async () => {
    await renderAccess();
    expect(
      within(document.getElementById('diagnosis') as HTMLElement).getByText(
        'Access 以外のシステムは「戻る」から選び直せます。'
      )
    ).toBeInTheDocument();
  });

  it('has no column links in English, where there are no columns', async () => {
    await renderAccess('en');
    expect(screen.queryByRole('region', { name: 'Articles on migrating Access' })).toBeNull();
    expect(screen.queryByRole('link', { name: /Access を直すか/ })).toBeNull();
    expect(
      screen.getByRole('region', { name: 'Migrating a core system such as AS/400 or ACOS?' })
    ).toBeInTheDocument();
  });
});

describe('Footer pages of the site', () => {
  const expected = [
    ['AXマイグレーション トップ', '/ja/ax-migration'],
    ['Microsoft Access の移行', '/ja/ax-migration/access'],
    ['コラム', '/ja/ax-migration/column'],
  ];
  const navLinks = () =>
    siteNav()
      .getAllByRole('link')
      .map((link) => [link.textContent, link.getAttribute('href')]);

  it('links the pages from the main landing page, in place', async () => {
    await renderMain();
    expect(navLinks()).toEqual(expected);
    for (const link of siteNav().getAllByRole('link')) expect(link).not.toHaveAttribute('target');
  });

  it('links the pages from the Access landing page', async () => {
    await renderAccess();
    expect(navLinks()).toEqual(expected);
  });

  it('links the pages from a column and measures the move', async () => {
    window.history.replaceState(null, '', '/ja/ax-migration/column/access-2gb-limit');
    const user = userEvent.setup();
    await renderColumn('access-2gb-limit');
    expect(navLinks()).toEqual(expected);

    await user.click(siteNav().getByRole('link', { name: 'Microsoft Access の移行' }));
    expect(events('ax_cross_link_click')).toEqual([
      {
        event: 'ax_cross_link_click',
        from_page: 'ax-column',
        to_page: 'ax-access-lp',
        location: 'footer',
        column_slug: 'access-2gb-limit',
      },
    ]);
  });

  it('has no column link in English', async () => {
    render(withIntl(await AxSiteFooter({ locale: 'en' }), 'en'));
    const nav = within(screen.getByRole('navigation', { name: 'Pages on this site' }));
    expect(nav.getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual([
      '/en/ax-migration',
      '/en/ax-migration/access',
    ]);
  });
});

describe('Access columns', () => {
  const slug = 'access-office-support-end';

  it('points the header button at the Access diagnosis', async () => {
    window.history.replaceState(null, '', `/ja/ax-migration/column/${slug}`);
    const user = userEvent.setup();
    await renderColumn(slug);

    // The site header comes first (the article has a header of its own)
    const header = within(screen.getAllByRole('banner')[0]);
    const button = header.getByRole('link', { name: '無料Web診断（Access版）' });
    expect(button).toHaveAttribute('href', '/ja/ax-migration/access#diagnosis');
    expect(header.queryByRole('link', { name: /^無料Web診断$/ })).toBeNull();

    await user.click(button);
    expect(button).toHaveAttribute(
      'href',
      '/ja/ax-migration/access?from=ax-column-header#diagnosis'
    );
    expect(events('ax_lp_cta_click')).toEqual([
      { event: 'ax_lp_cta_click', cta: 'diagnosis', location: 'header', page: 'ax-column' },
    ]);
    expect(events('ax_cross_link_click')).toEqual([
      {
        event: 'ax_cross_link_click',
        from_page: 'ax-column',
        to_page: 'ax-access-lp',
        location: 'header',
        to_section: 'diagnosis',
        column_slug: slug,
      },
    ]);
  });

  it('names the end button after the article, and measures links of the text', async () => {
    window.history.replaceState(null, '', `/ja/ax-migration/column/${slug}?utm_medium=email`);
    const user = userEvent.setup();
    await renderColumn(slug);

    const end = screen.getByRole('link', { name: '無料Web診断（Access版）をはじめる' });
    await user.click(end);
    expect(end).toHaveAttribute(
      'href',
      '/ja/ax-migration/access?utm_medium=email&from=ax-column-end#diagnosis'
    );
    expect(events('ax_lp_cta_click')).toEqual([
      { event: 'ax_lp_cta_click', cta: 'diagnosis', location: `column-end-${slug}`, page: 'ax-column' },
    ]);

    const inText = screen.getByRole('link', { name: '無料Web診断（Access版）を見る' });
    await user.click(inText);
    expect(inText).toHaveAttribute(
      'href',
      '/ja/ax-migration/access?utm_medium=email&from=ax-column-body#diagnosis'
    );
    expect(events('ax_cross_link_click').map((event) => event.location)).toEqual(['end', 'body']);
    expect(events('ax_cross_link_click')[1]).toEqual({
      event: 'ax_cross_link_click',
      from_page: 'ax-column',
      to_page: 'ax-access-lp',
      location: 'body',
      to_section: 'diagnosis',
      column_slug: slug,
    });
  });

  it('measures the breadcrumb link to the main page as a move between pages', async () => {
    window.history.replaceState(null, '', `/ja/ax-migration/column/${slug}`);
    const user = userEvent.setup();
    await renderColumn(slug);
    const crumbs = within(screen.getByRole('navigation', { name: 'パンくずリスト' }));
    const home = crumbs.getByRole('link', { name: 'AXマイグレーション' });
    await user.click(home);
    expect(home).toHaveAttribute('href', '/ja/ax-migration?from=ax-column-breadcrumb');
    expect(events('ax_cross_link_click')).toEqual([
      {
        event: 'ax_cross_link_click',
        from_page: 'ax-column',
        to_page: 'ax-lp',
        location: 'breadcrumb',
        column_slug: slug,
      },
    ]);
  });

  it('leaves links to other columns as plain links', async () => {
    window.history.replaceState(null, '', '/ja/ax-migration/column/access-2gb-limit');
    const user = userEvent.setup();
    await renderColumn('access-2gb-limit');
    const article = within(screen.getByRole('article'));
    const toColumn = article
      .getAllByRole('link')
      .find((link) => link.getAttribute('href') === '/ja/ax-migration/column/access-shared-folder');
    expect(toColumn).toBeDefined();
    await user.click(toColumn as HTMLElement);
    expect(toColumn).toHaveAttribute('href', '/ja/ax-migration/column/access-shared-folder');
    expect(events('ax_cross_link_click')).toEqual([]);
  });
});

describe('entry of the diagnosis events', () => {
  it('is added to the events of the diagnosis, not to the moves between pages', () => {
    setAxDiagnosisEntry('ax-access-lp');
    trackAxEvent('ax_consultation_request', { source: 'result', platform: 'access' });
    trackAxEvent('ax_lp_cta_click', { cta: 'diagnosis', location: 'hero', page: 'ax-access-lp' });
    expect(events('ax_consultation_request')).toEqual([
      { event: 'ax_consultation_request', entry: 'ax-access-lp', source: 'result', platform: 'access' },
    ]);
    expect(events('ax_lp_cta_click')[0]).not.toHaveProperty('entry');

    setAxDiagnosisEntry(undefined);
    trackAxEvent('ax_diagnosis_start', { platform: 'access' });
    expect(events('ax_diagnosis_start')[0]).not.toHaveProperty('entry');
  });

  it('adds the from of the address, when the site wrote it, the same way (#332)', () => {
    window.history.replaceState(null, '', '/ja/ax-migration/access?from=ax-lp-targets-access');
    setAxDiagnosisEntry('ax-access-lp');
    trackAxEvent('ax_diagnosis_complete', { platform: 'access' });
    trackAxEvent('ax_cross_link_click', { from_page: 'ax-access-lp', to_page: 'ax-lp', location: 'hosts' });
    expect(events('ax_diagnosis_complete')).toEqual([
      {
        event: 'ax_diagnosis_complete',
        entry: 'ax-access-lp',
        from: 'ax-lp-targets-access',
        platform: 'access',
      },
    ]);
    expect(events('ax_cross_link_click')[0]).not.toHaveProperty('from');

    window.history.replaceState(null, '', '/ja/ax-migration/access?from=somewhere-else');
    setAxDiagnosisEntry('ax-access-lp');
    trackAxEvent('ax_diagnosis_step', { platform: 'access', step: 2 });
    expect(events('ax_diagnosis_step')).toEqual([
      { event: 'ax_diagnosis_step', entry: 'ax-access-lp', platform: 'access', step: 2 },
    ]);
  });

  it('is sent with the start and step events of the main page diagnosis', async () => {
    window.history.replaceState(null, '', '/ja/ax-migration');
    const user = userEvent.setup();
    await renderMain();
    await user.click(accessCard().getByRole('link', { name: 'Accessの質問から無料Web診断をはじめる' }));
    expect(events('ax_diagnosis_start')).toEqual([
      { event: 'ax_diagnosis_start', entry: 'ax-lp', platform: 'access' },
    ]);
    expect(events('ax_diagnosis_step')).toEqual([
      { event: 'ax_diagnosis_step', entry: 'ax-lp', platform: 'access', step: 2 },
    ]);
  });
});

describe('Header menu on phones', () => {
  const menuButton = () => screen.getByRole('button', { name: 'メニュー' });
  const openMenu = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(menuButton());
    return within(screen.getByRole('navigation', { name: 'サイト内のメニュー' }));
  };
  const items = (menu: ReturnType<typeof within>) =>
    menu.getAllByRole('link').map((link) => [link.textContent, link.getAttribute('href')]);
  const SECTIONS_HERE = [
    ['お悩み', '#problems'],
    ['特長', '#reasons'],
    ['デモ', '#demo'],
    ['進め方', '#steps'],
    ['対象システム', '#targets'],
    ['よくある質問', '#faq'],
  ];
  // The Access page has no reasons or demo section of its own (#414); its approach is its three
  // ways, not the flow (#537)
  const ACCESS_SECTIONS = [
    ['お悩み', '#problems'],
    ['進め方', '#paths'],
    ['対象システム', '#targets'],
    ['よくある質問', '#faq'],
  ];

  it('opens and closes the panel with its button', async () => {
    const user = userEvent.setup();
    await renderMain();
    const button = menuButton();
    expect(button).toHaveAttribute('aria-expanded', 'false');
    const panel = document.getElementById(button.getAttribute('aria-controls') ?? '');
    expect(panel).not.toBeNull();
    expect(panel).not.toBeVisible();
    expect(screen.queryByRole('navigation', { name: 'サイト内のメニュー' })).toBeNull();

    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(panel).toBeVisible();
    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(panel).not.toBeVisible();
  });

  it('lists the sections, the columns and the Access page on the main page', async () => {
    const user = userEvent.setup();
    await renderMain();
    expect(items(await openMenu(user))).toEqual([
      ...SECTIONS_HERE,
      ['コラム', '/ja/ax-migration/column'],
      ['Microsoft Access の移行', '/ja/ax-migration/access'],
    ]);
  });

  it('links to the main page instead of itself on the Access page', async () => {
    const user = userEvent.setup();
    await renderAccess();
    expect(items(await openMenu(user))).toEqual([
      ...ACCESS_SECTIONS,
      ['コラム', '/ja/ax-migration/column'],
      ['AXマイグレーション トップ', '/ja/ax-migration'],
    ]);
  });

  it('opens the main page sections from a column and links both landing pages', async () => {
    const user = userEvent.setup();
    await renderColumn('access-2gb-limit');
    expect(items(await openMenu(user))).toEqual([
      ['お悩み', '/ja/ax-migration#problems'],
      ['特長', '/ja/ax-migration#reasons'],
      ['デモ', '/ja/ax-migration#demo'],
      ['進め方', '/ja/ax-migration#steps'],
      ['対象システム', '/ja/ax-migration#targets'],
      ['よくある質問', '/ja/ax-migration#faq'],
      ['コラム', '/ja/ax-migration/column'],
      ['AXマイグレーション トップ', '/ja/ax-migration'],
      ['Microsoft Access の移行', '/ja/ax-migration/access'],
    ]);
  });

  it('has no column link in English', async () => {
    const user = userEvent.setup();
    render(withIntl(await resolveServerTree(await AxMigrationPage(params('en'))), 'en'));
    await user.click(screen.getByRole('button', { name: 'Menu' }));
    const menu = within(screen.getByRole('navigation', { name: 'Site menu' }));
    expect(menu.getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual([
      '#problems',
      '#reasons',
      '#demo',
      '#steps',
      '#targets',
      '#faq',
      '/en/ax-migration/access',
    ]);
  });

  it('closes on Escape and gives the focus back to the button', async () => {
    const user = userEvent.setup();
    await renderMain();
    const menu = await openMenu(user);
    menu.getAllByRole('link')[0].focus();
    await user.keyboard('{Escape}');
    expect(menuButton()).toHaveAttribute('aria-expanded', 'false');
    expect(menuButton()).toHaveFocus();
  });

  it('closes on a press outside it', async () => {
    const user = userEvent.setup();
    await renderMain();
    await openMenu(user);
    await user.click(screen.getByRole('heading', { level: 1 }));
    expect(menuButton()).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes when a link is followed, measuring a move to another page', async () => {
    window.history.replaceState(null, '', '/ja/ax-migration');
    const user = userEvent.setup();
    await renderMain();
    const link = (await openMenu(user)).getByRole('link', { name: 'Microsoft Access の移行' });
    await user.click(link);
    expect(menuButton()).toHaveAttribute('aria-expanded', 'false');
    expect(menuButton()).toHaveFocus();
    expect(link).toHaveAttribute('href', '/ja/ax-migration/access?from=ax-lp-header');
    expect(events('ax_cross_link_click')).toEqual([
      {
        event: 'ax_cross_link_click',
        from_page: 'ax-lp',
        to_page: 'ax-access-lp',
        location: 'header',
      },
    ]);
  });
});
