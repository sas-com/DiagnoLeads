/**
 * AX migration landing page (server components rendered with the real messages)
 */
import { evaluateAxMigration, toPublicResult } from '@/lib/features/diagnostics/ax-migration/evaluate';
import messages from '@/locales/ja/common.json';
import { as400Answers } from '@/test/fixtures/ax-migration';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider, createTranslator } from 'next-intl';
import { type ReactElement, type ReactNode, cloneElement, isValidElement } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next-intl/server', () => ({
  getTranslations: async ({ locale, namespace }: { locale: string; namespace?: string }) =>
    createTranslator({ locale, messages, namespace: namespace as never }),
}));
vi.mock('next/font/google', () => ({
  Noto_Sans_JP: () => ({ variable: 'font-noto' }),
  Lato: () => ({ variable: 'font-lato' }),
}));

const { default: AxMigrationPage } = await import('@/app/[locale]/(ax)/ax-migration/page');
const { default: AxDiagnosisPage } = await import('@/app/[locale]/(ax)/ax-diagnosis/page');
const { AxSiteHeader } = await import('@/components/features/ax-site/ax-site-header');
const { AxSiteFooter } = await import('@/components/features/ax-site/ax-site-footer');
const { AxHero } = await import('@/components/features/ax-site/landing-sections');
const { AxFloatingCta } = await import('@/components/features/ax-site/ax-floating-cta');

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  window.scrollTo = vi.fn() as typeof window.scrollTo;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
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
      'まずは「無料Web診断」から',
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

  it('states the end of Office support on the Access item, with its date (#288)', async () => {
    await renderPage();
    const access = screen.getByRole('heading', { level: 3, name: 'Microsoft Access' }).closest('li') as HTMLElement;
    expect(within(access).getByText(/2026年10月13日/)).toBeInTheDocument();
    expect(
      within(access).getByRole('link', { name: 'お使いの版と進め方の目安を、無料Web診断で確認する' })
    ).toHaveAttribute('href', '#diagnosis');
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
      'スピード',
      '高品質',
    ]) {
      expect(screen.getAllByRole('heading', { level: 3, name }).length).toBeGreaterThanOrEqual(1);
    }
    expect(screen.getByText('経営判断').tagName).toBe('EM');
    const reasons = screen.getByRole('heading', { level: 2, name: '選ばれる理由' }).closest('section');
    expect(
      within(reasons as HTMLElement).getByText(/^※お預かりした仕様書・ソースコードなどは/)
    ).toBeInTheDocument();
  });

  it('names the audience, leads from the concerns to the check and orders the steps', async () => {
    await renderPage();
    expect(screen.getByText('製造業・流通業の中堅企業さまへ')).toBeInTheDocument();
    const problems = document.getElementById('problems') as HTMLElement;
    expect(within(problems).getByRole('link', { name: /無料Web診断をはじめる/ })).toHaveAttribute(
      'href',
      '#diagnosis'
    );
    const steps = within(document.getElementById('steps') as HTMLElement)
      .getAllByRole('heading', { level: 3 })
      .map((heading) => heading.textContent);
    expect(steps.slice(0, 2)).toEqual(['無料Web診断（約3分）', '簡易診断（担当者による資産の棚卸し）']);
    // Reasons come before the diagnosis, which asks for contact details
    const reasons = screen.getByRole('heading', { level: 2, name: '選ばれる理由' });
    const diagnosis = screen.getByRole('heading', { level: 2, name: 'まずは「無料Web診断」から' });
    expect(reasons.compareDocumentPosition(diagnosis) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    for (const question of ['「AX化」とは何ですか？', '今の保守会社がソースコードを持っています。相談できますか？']) {
      expect(screen.getByText(question)).toBeInTheDocument();
    }
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
    const buttons = screen.getAllByRole('link', { name: /無料Web診断/ });
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
    expect(screen.getByRole('link', { name: /^無料Web診断$/ })).toHaveAttribute(
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

describe('AX migration landing page after the diagnosis (#280)', () => {
  const fetchMock = vi.fn();
  type User = ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
      ok: true,
      status: 201,
      headers: new Headers(),
      json: async () => ({
        submissionId: 'sub-1',
        consultationRequested: false,
        result: toPublicResult(evaluateAxMigration(as400Answers)),
      }),
    } as Response);
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    window.localStorage.clear();
    vi.mocked(Element.prototype.scrollIntoView).mockClear();
    vi.mocked(window.scrollTo).mockClear();
  });

  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  const inGroup = (name: RegExp) => within(screen.getByRole('group', { name }));
  const next = (user: User) => user.click(screen.getByRole('button', { name: /次へ/ }));

  async function diagnose(user: User) {
    await user.click(screen.getByTestId('platform-as400'));
    await user.click(inGroup(/直せる（改修できる）人/).getByLabelText(/当面は続けられる/));
    await user.click(inGroup(/保守期限/).getByLabelText('1〜3年以内'));
    await user.click(inGroup(/データのやり取り/).getByLabelText('いくつかある（3〜9）'));
    await next(user);
    await user.click(inGroup(/プログラムはおよそ何本/).getByLabelText('500〜1,999本'));
    await user.click(inGroup(/どんな言語・方法/).getByLabelText(/RPG IV/));
    await user.click(inGroup(/仕様書は手元/).getByLabelText(/ソースが一部見当たらない/));
    await next(user);
    await user.click(inGroup(/いま感じている課題/).getByLabelText(/扱える人が減って/));
    await user.click(inGroup(/切り替えを目指す時期/).getByLabelText('1〜2年以内'));
    await user.click(inGroup(/業種/).getByLabelText('製造業'));
    await user.click(inGroup(/あなたの立場/).getByLabelText('情報システム部門の責任者'));
    await next(user);
    await next(user);
    await user.type(screen.getByLabelText(/会社名/), '三田製作所');
    await user.type(screen.getByLabelText(/お名前/), '山田 太郎');
    await user.type(screen.getByLabelText(/会社のメールアドレス/), 'yamada@example.jp');
    await user.click(screen.getByLabelText('個人情報の取り扱いに同意する'));
    await user.click(screen.getByRole('button', { name: /診断結果を見る/ }));
    return screen.findByRole('heading', { name: '診断結果' });
  }

  /** Sections other than the diagnosis, by the heading or the anchor they carry */
  const otherSections = () => ({
    hero: document.getElementById('ax-hero-heading'),
    problems: document.getElementById('problems'),
    challenges: document.getElementById('ax-challenges-heading'),
    steps: document.getElementById('steps'),
    targets: document.getElementById('targets'),
    reasons: document.getElementById('ax-reasons-heading'),
    faq: document.getElementById('faq'),
    final: document.getElementById('ax-final'),
    floating: screen.queryByTestId('ax-floating-cta'),
  });
  const scrolledTo = () =>
    vi.mocked(Element.prototype.scrollIntoView).mock.contexts.map((element) => (element as Element).id);

  it('shows only the result from the top of the page', { timeout: 30000 }, async () => {
    const user = userEvent.setup();
    await renderPage();
    expect(Object.values(otherSections()).every((element) => element !== null)).toBe(true);

    const heading = await diagnose(user);
    // The submission names this page as its entry (#296)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).tracking.entry).toBe('ax-lp');

    for (const [name, element] of Object.entries(otherSections())) {
      expect(element, name).toBeNull();
    }
    expect(screen.queryByRole('heading', { name: '選ばれる理由' })).not.toBeInTheDocument();
    // The section's own introduction is left out as well: the result is the page, as on /ax-diagnosis
    expect(document.getElementById('ax-diagnosis-heading')).toBeNull();
    const diagnosis = document.getElementById('diagnosis') as HTMLElement;
    expect(diagnosis).toContainElement(heading);
    expect(diagnosis).not.toHaveAttribute('aria-labelledby');
    // One h1: the result's title, focused for screen readers
    expect(screen.getAllByRole('heading', { level: 1 })).toEqual([heading]);
    expect(heading).toHaveFocus();
    expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: 'auto' });
    // The header stays (the diagnosis button there leads to the result)
    expect(screen.getByRole('link', { name: '進め方' })).toBeInTheDocument();
  });

  it('brings the page back when the respondent diagnoses another system', { timeout: 30000 }, async () => {
    const user = userEvent.setup();
    await renderPage();
    await diagnose(user);
    vi.mocked(Element.prototype.scrollIntoView).mockClear();

    await user.click(screen.getByRole('button', { name: '別のシステムも診断する' }));

    for (const [name, element] of Object.entries(otherSections())) {
      expect(element, name).not.toBeNull();
    }
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(
      screen.getByRole('heading', { level: 1, name: '今の基幹システムのまま、AI時代の経営判断はできますか？' })
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'まずは「無料Web診断」から' })).toBeInTheDocument();
    expect(within(document.getElementById('diagnosis') as HTMLElement).getByTestId('platform-as400')).toBeInTheDocument();
    expect(scrolledTo().at(-1)).toBe('diagnosis');
  });

  it('brings the page back for a header link to a left-out section', { timeout: 30000 }, async () => {
    const user = userEvent.setup();
    await renderPage();
    await diagnose(user);
    vi.mocked(Element.prototype.scrollIntoView).mockClear();

    await user.click(screen.getByRole('link', { name: '進め方' }));

    const steps = document.getElementById('steps');
    expect(steps).not.toBeNull();
    expect(scrolledTo().at(-1)).toBe('steps');
    expect(window.location.hash).toBe('#steps');
    // The result stays where the diagnosis is, one level below the page title
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 3, name: '診断結果' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'まずは「無料Web診断」から' })).toBeInTheDocument();
  });

  it('leaves the standalone diagnosis page as it is', { timeout: 30000 }, async () => {
    const user = userEvent.setup();
    render(
      withIntl(
        await resolveServerTree(await AxDiagnosisPage({ params: Promise.resolve({ locale: 'ja' }) }))
      )
    );
    const heading = await diagnose(user);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).tracking.entry).toBe('ax-diagnosis');

    expect(screen.getAllByRole('heading', { level: 1 })).toEqual([heading]);
    expect(heading).toHaveFocus();
    expect(window.scrollTo).not.toHaveBeenCalled();
    // Header links open the landing page; nothing on this page is swapped out
    expect(screen.getByRole('link', { name: '進め方' })).toHaveAttribute('href', '/ja/ax-migration#steps');
  });
});
