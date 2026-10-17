/**
 * AX migration landing page (server components rendered with the real messages)
 */
import messages from '@/locales/ja/common.json';
import { act, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider, createTranslator } from 'next-intl';
import { type ReactElement, type ReactNode, cloneElement, isValidElement } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('next-intl/server', () => ({
  getTranslations: async ({ locale, namespace }: { locale: string; namespace?: string }) =>
    createTranslator({ locale, messages, namespace: namespace as never }),
}));
vi.mock('next/font/google', () => ({
  Noto_Sans_JP: () => ({ variable: 'font-noto' }),
  Lato: () => ({ variable: 'font-lato' }),
}));

const { default: AxMigrationPage } = await import('@/app/[locale]/(public)/ax-migration/page');
const { AxSiteHeader } = await import('@/components/features/ax-site/ax-site-header');
const { AxSiteFooter } = await import('@/components/features/ax-site/ax-site-footer');
const { AxHero } = await import('@/components/features/ax-site/landing-sections');
const { AxFloatingCta } = await import('@/components/features/ax-site/ax-floating-cta');

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/**
 * Server components may nest other async server components, which the test renderer cannot
 * await: resolve them first, then render the plain tree.
 */
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
  // Passed one by one (not as an array) so React does not ask for keys
  return cloneElement(element, undefined, ...(Array.isArray(children) ? children : [children]));
}

const renderPage = async () =>
  render(
    withIntl(
      await resolveServerTree(await AxMigrationPage({ params: Promise.resolve({ locale: 'ja' }) }))
    )
  );

const withIntl = (ui: ReactNode) => (
  <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
    {ui}
  </NextIntlClientProvider>
);

describe('AX migration landing page', () => {
  it('has one h1, every section and the diagnosis embedded', async () => {
    await renderPage();

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    for (const name of [
      'こんなお悩みありませんか？',
      'ヒト・モノ・カネ・情報。すべてが、レガシーな基幹システムに縛られています',
      'システム移行はゴールではなく、AX化の出発点',
      '対象となるシステム',
      'まずは「移行診断」を無料で',
      '選ばれる理由',
      'よくある質問',
      '次の一歩を、AXへの一歩に。',
    ]) {
      expect(screen.getByRole('heading', { level: 2, name })).toBeInTheDocument();
    }
    const diagnosis = document.getElementById('diagnosis') as HTMLElement;
    expect(within(diagnosis).getByTestId('platform-acos')).toBeInTheDocument();
    for (const name of ['AS/400（IBM i）', 'NEC ACOS', 'Microsoft Access']) {
      expect(screen.getByRole('heading', { level: 3, name })).toBeInTheDocument();
    }
  });

  it('follows the brochure: the four challenges, the phases and the reasons', async () => {
    await renderPage();
    expect(
      screen.getByRole('heading', { level: 1, name: '今の基幹システムのまま、AI時代の経営判断はできますか？' })
    ).toBeInTheDocument();
    for (const name of [
      '人に依存した基幹システム',
      '市場の変化に対応できないシステム',
      '成長の余地を狭める“延命コスト”',
      '経営判断に使えないデータ',
      '現行仕様調査',
      'マイグレーション',
      'AX化',
      '短納期',
      '高品質',
    ]) {
      expect(screen.getAllByRole('heading', { level: 3, name }).length).toBeGreaterThanOrEqual(1);
    }
    expect(screen.getByText('高成長の経営判断').tagName).toBe('EM');
    const reasons = screen.getByRole('heading', { level: 2, name: '選ばれる理由' }).closest('section');
    expect(
      within(reasons as HTMLElement).getByText(/^※お預かりした仕様書・ソースコードなどは/)
    ).toBeInTheDocument();
  });

  it('links the phone and email of the DX Services Division', async () => {
    await renderPage();
    expect(screen.getByRole('link', { name: 'dx-agency@sas-com.com' })).toHaveAttribute(
      'href',
      'mailto:dx-agency@sas-com.com'
    );
    expect(screen.getByRole('link', { name: '03-5427-3663' })).toHaveAttribute(
      'href',
      'tel:+81354273663'
    );
  });

  it('loads GA4 only with a valid measurement ID', async () => {
    const gtagScripts = () => document.head.querySelectorAll('script[src*="googletagmanager.com"]');
    await renderPage();
    expect(gtagScripts()).toHaveLength(0);

    vi.stubEnv('NEXT_PUBLIC_GA_MEASUREMENT_ID', 'not-an-id');
    await renderPage();
    expect(gtagScripts()).toHaveLength(0);

    vi.stubEnv('NEXT_PUBLIC_GA_MEASUREMENT_ID', 'G-TEST1234');
    await renderPage();
    expect(gtagScripts()).toHaveLength(1);
    for (const script of gtagScripts()) script.remove();
    (window as Window & { gtag?: unknown }).gtag = undefined;
  });

  it('points every diagnosis button at the embedded diagnosis', async () => {
    await renderPage();
    const buttons = screen.getAllByRole('link', { name: /かんたん無料診断をはじめる|無料で診断する/ });
    expect(buttons.length).toBeGreaterThanOrEqual(3);
    for (const button of buttons) expect(button).toHaveAttribute('href', '#diagnosis');
  });

  it('shows the booking button only when a booking URL is configured', async () => {
    render(withIntl(await AxHero({ locale: 'ja' })));
    expect(screen.queryByRole('link', { name: /無料相談を予約する/ })).not.toBeInTheDocument();

    vi.stubEnv('NEXT_PUBLIC_AX_CONSULTATION_URL', 'https://bookings.example.com/ax');
    render(withIntl(await AxHero({ locale: 'ja' })));
    const booking = screen.getByRole('link', { name: /無料相談を予約する/ });
    expect(booking).toHaveAttribute('href', 'https://bookings.example.com/ax');
    expect(booking).toHaveAttribute('target', '_blank');
    expect(booking).toHaveAttribute('rel', 'noopener noreferrer');
  });
});

describe('AxSiteHeader', () => {
  it('scrolls within the landing page', async () => {
    render(withIntl(await AxSiteHeader({ locale: 'ja', variant: 'landing' })));
    expect(screen.getByRole('link', { name: '進め方' })).toHaveAttribute('href', '#steps');
  });

  it('opens the landing page sections from other pages', async () => {
    render(withIntl(await AxSiteHeader({ locale: 'ja', variant: 'standalone' })));
    expect(screen.getByRole('link', { name: '進め方' })).toHaveAttribute(
      'href',
      '/ja/ax-migration#steps'
    );
    expect(screen.getByRole('link', { name: /無料で診断する/ })).toHaveAttribute(
      'href',
      '/ja/ax-migration#diagnosis'
    );
  });
});

describe('AxSiteFooter', () => {
  it('links the operator and hides the privacy policy until it is configured', async () => {
    render(withIntl(await AxSiteFooter({ locale: 'ja' })));
    expect(screen.getByRole('link', { name: /運営会社/ })).toHaveAttribute('href', 'https://sas-com.com/');
    expect(screen.queryByRole('link', { name: /個人情報保護方針/ })).not.toBeInTheDocument();
  });

  it('shows the logo and the copyright of the current year', async () => {
    render(withIntl(await AxSiteFooter({ locale: 'ja' })));
    const footer = screen.getByRole('contentinfo');
    expect(within(footer).getByText('マイグレーション')).toBeInTheDocument();
    expect(
      within(footer).getByText(`Copyright © ${new Date().getFullYear()}`, { exact: false })
    ).toBeInTheDocument();
  });

  it('shows the privacy policy once its URL is set', async () => {
    vi.stubEnv('NEXT_PUBLIC_AX_PRIVACY_POLICY_URL', 'https://sas-com.com/privacy/');
    render(withIntl(await AxSiteFooter({ locale: 'ja' })));
    expect(screen.getByRole('link', { name: /個人情報保護方針/ })).toHaveAttribute(
      'href',
      'https://sas-com.com/privacy/'
    );
  });
});

describe('AxFloatingCta', () => {
  it('appears only while no other diagnosis button is on screen', () => {
    let callback: IntersectionObserverCallback = () => {};
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(cb: IntersectionObserverCallback) {
          callback = cb;
        }
        observe() {}
        disconnect() {}
      }
    );
    render(
      withIntl(
        <>
          <section id="diagnosis" />
          <AxFloatingCta label="かんたん無料診断をはじめる" hideWhenVisible={['diagnosis']} />
        </>
      )
    );
    const bar = screen.getByText('かんたん無料診断をはじめる').closest('div') as HTMLElement;
    expect(bar).toHaveAttribute('aria-hidden', 'true');

    const target = document.getElementById('diagnosis') as HTMLElement;
    act(() => callback([{ target, isIntersecting: false } as unknown as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(bar).toHaveAttribute('aria-hidden', 'false');

    act(() => callback([{ target, isIntersecting: true } as unknown as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(bar).toHaveAttribute('aria-hidden', 'true');
  });
});
