/**
 * AX migration landing page (server components rendered with the real messages)
 */
import { evaluateAxMigration, toPublicResult } from '@/lib/features/diagnostics/ax-migration/evaluate';
import enMessages from '@/locales/en/common.json';
import messages from '@/locales/ja/common.json';
import { as400Answers } from '@/test/fixtures/ax-migration';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider, createTranslator } from 'next-intl';
import { type ReactElement, type ReactNode, cloneElement, isValidElement } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next-intl/server', () => ({
  getTranslations: async ({ locale, namespace }: { locale: string; namespace?: string }) =>
    createTranslator({
      locale,
      messages: (locale === 'en' ? enMessages : messages) as typeof messages,
      namespace: namespace as never,
    }),
}));
vi.mock('next/font/google', () => ({
  Noto_Sans_JP: () => ({ variable: 'font-noto' }),
  Lato: () => ({ variable: 'font-lato' }),
}));

const { default: AxMigrationPage, generateMetadata } = await import(
  '@/app/[locale]/(ax)/ax-migration/page'
);
const { default: AxDiagnosisPage } = await import('@/app/[locale]/(ax)/ax-diagnosis/page');
const { AxSiteHeader } = await import('@/components/features/ax-site/ax-site-header');
const { AxSiteFooter } = await import('@/components/features/ax-site/ax-site-footer');
const { AxChallenges, AxFinalCta } = await import(
  '@/components/features/ax-site/landing-sections'
);
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
      '基幹システムの移行から、AX化までを一貫してご支援',
      'ヒト・モノ・カネ・情報。すべてが、レガシーな基幹システムに縛られています',
      'AXマイグレーションの3つの特長',
      '移行の進め方、まずはご相談ください',
      '受注入力の画面で、移行前後を見比べられます',
      'AX化の進め方',
      '対象となるシステム',
      'AS/400（IBM i）からの移行を考えている方へ',
      'NEC ACOSからの移行を考えている方へ',
      '安心して任せられる理由',
      'まずは「無料Web診断」から',
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
      within(access).getByRole('link', { name: 'Accessの質問から無料Web診断をはじめる' })
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
      'AIで現行の仕様を見える化',
      '新旧で同じデータを流して突き合わせる',
      '段階的に進め、AX化まで続ける',
    ]) {
      expect(screen.getAllByRole('heading', { level: 3, name }).length).toBeGreaterThanOrEqual(1);
    }
    // Each strength answers one concern (#414)
    for (const concern of ['「期間」の不安に', '「業務影響」の不安に', '「費用」の不安に']) {
      expect(screen.getByText(concern)).toBeInTheDocument();
    }
    const reasons = screen.getByRole('heading', { level: 2, name: 'AXマイグレーションの3つの特長' }).closest('section');
    expect(
      within(reasons as HTMLElement).getByText(/^※お預かりした仕様書・ソースコードなどは/)
    ).toBeInTheDocument();
  });

  it('says what the diagnosis tells, and quotes the customers in each language (#535)', async () => {
    await renderPage();
    // The diagnosis asks for the deadlines: it tells how pressing they are, not what they are
    expect(
      screen.getByText('期限までの急ぎ度合いと、移行の難しさの目安が、約3分でわかります')
    ).toBeInTheDocument();
    expect(screen.queryByText(/保守期限と移行の難しさの目安/)).toBeNull();
    const challenges = document.getElementById('ax-challenges-heading')?.closest('section');
    expect(
      within(challenges as HTMLElement).getByText('「RPGやCOBOLを直せる人が、社内に1〜2人しかいない」')
    ).toBeInTheDocument();

    // No Japanese brackets around the English quotes
    const english = render(withIntl(await AxChallenges({ locale: 'en' })));
    expect(english.container).toHaveTextContent(
      '“Only one or two people in the company can fix the RPG or COBOL”'
    );
    expect(english.container.textContent).not.toMatch(/[「」]/);
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
    // The free consultation is a step of its own before the quick assessment (#420)
    expect(steps.slice(0, 3)).toEqual([
      '無料Web診断（約3分）',
      '無料の個別相談',
      '簡易診断（担当者による資産の棚卸し）',
    ]);
    // Reassurance comes before the diagnosis, which asks for contact details
    const trust = screen.getByRole('heading', { level: 2, name: '安心して任せられる理由' });
    const diagnosis = screen.getByRole('heading', { level: 2, name: 'まずは「無料Web診断」から' });
    expect(trust.compareDocumentPosition(diagnosis) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    for (const question of ['「AX化」とは何ですか？', '今の保守会社がソースコードを持っています。相談できますか？']) {
      expect(screen.getByText(question)).toBeInTheDocument();
    }
  });

  it('links the phone and email of the DX Services Division', async () => {
    await renderPage();
    // In the consultation band halfway down and in the final call to action (#420)
    const emails = screen.getAllByRole('link', { name: 'dx-agency@sas-com.com' });
    const phones = screen.getAllByRole('link', { name: '03-5427-3663' });
    expect(emails).toHaveLength(2);
    expect(phones).toHaveLength(2);
    for (const email of emails) expect(email).toHaveAttribute('href', 'mailto:dx-agency@sas-com.com');
    for (const phone of phones) expect(phone).toHaveAttribute('href', 'tel:+81354273663');
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

  it('opens the demo in a new tab from the hero and the demo section (#414)', async () => {
    await renderPage();
    const demos = screen.getAllByRole('link', { name: /デモを見る/ });
    expect(demos).toHaveLength(2);
    for (const demo of demos) {
      // Says it opens a new tab, not only with an icon (#420)
      expect(demo).toHaveAccessibleName('デモを見る（新しいタブで開きます）');
      expect(demo).toHaveAttribute('href', 'https://as400-pre-migration.vercel.app/');
      expect(demo).toHaveAttribute('target', '_blank');
      expect(demo).toHaveAttribute('rel', 'noopener noreferrer');
    }
    expect(
      screen.getByRole('img', { name: /AS\/400風の受注入力画面と、移行後を想定したWebの受注入力画面/ })
    ).toBeInTheDocument();
  });

  it('names the deadlines that make a renewal urgent, above the hero buttons (#420)', async () => {
    await renderPage();
    const hero = screen.getByRole('heading', { level: 1 }).closest('section') as HTMLElement;
    const deadlines = within(hero).getAllByRole('listitem').map((item) => item.textContent);
    expect(deadlines).toEqual([
      '保守期限・リース満了',
      '直せる人の退職・異動',
      'INSネットを使うEDI（2028年12月31日に提供終了と発表）',
    ]);
    // Before the buttons, which the phone CTA bar watches on their own: not even the caption
    // above them, which can be on screen while the buttons are not (#536)
    const buttons = document.getElementById('ax-hero-cta') as HTMLElement;
    expect(within(buttons).getByRole('link', { name: /無料Web診断をはじめる/ })).toBeInTheDocument();
    expect(buttons).not.toHaveTextContent('約3分でわかります');
  });

  it('answers what deciders ask before a consultation (#420)', async () => {
    await renderPage();
    for (const question of [
      '費用や期間はどのくらいかかりますか？',
      '一部の業務やシステムから始められますか？',
      '相談の前に用意しておくとよいものはありますか？',
    ]) {
      expect(screen.getByText(question)).toBeInTheDocument();
    }
  });

  it('answers the worry about moving to the web near the top, in the reader\'s words (#466, #841)', async () => {
    await renderPage();
    const faq = document.getElementById('faq') as HTMLElement;
    const questions = [...faq.querySelectorAll('summary')].map((summary) =>
      summary.textContent?.replace(/^Q/, '')
    );
    const targets = questions.indexOf('どのようなシステムが対象ですか？');
    expect(questions.slice(targets + 1, targets + 4)).toEqual([
      '社内だけで使っていたシステムをWebにして、セキュリティは大丈夫ですか？',
      '社外から使えるようにしなくても、Webに移せますか？',
      '情報システム部門の審査に向けて、説明してもらえますか？',
    ]);
    // Next to the other question about the data
    expect(questions.indexOf('個人情報が入っていても、相談できますか？')).toBe(
      questions.indexOf('お預けした仕様書やソースコードは、AIの学習に使われますか？') + 1
    );
    const answer = within(faq).getByText(/^ご心配はもっともです。/);
    expect(answer).toHaveTextContent('移行の進め方を決めるときに一緒に決めます。');
    // We keep fixing it after the move, and how much is left to us is agreed (owner, 2026-10-27)
    expect(answer).toHaveTextContent('直し続ける体制まで、作った当社が用意します。');
    expect(answer).toHaveTextContent('どこまでお任せいただくかは、進め方とあわせてご相談します。');
    expect(answer).toHaveTextContent(
      'OSや製品の保守が終わると、今お使いのシステムでも、見つかった弱点は直されなくなります。'
    );
    // Never a menu to pick from on the first contact (#464)
    expect(
      within(faq).getByText(/^社内のネットワークからだけ使う形もあります。/)
    ).toHaveTextContent('お客様の社内の決まりを伺ってから決めます。');
  });

  it('says a web system need not be open to the internet, after the host systems (#838, #840)', async () => {
    await renderPage();
    const heading = screen.getByRole('heading', {
      level: 2,
      name: 'Webシステムにしても、インターネットに公開するとは限りません',
    });
    const hosts = document.getElementById('acos-migration') as HTMLElement;
    const trust = screen.getByRole('heading', { level: 2, name: '安心して任せられる理由' });
    expect(hosts.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(heading.compareDocumentPosition(trust) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const section = within(heading.closest('section') as HTMLElement);
    expect(section.getByText('閉じて守る、から、決めて守るへ')).toBeInTheDocument();
    for (const name of [
      '社内だけで使っている',
      '社内のネットワークからだけ使う',
      '社外（在宅・ほかの拠点）からも使う',
      'Webに移すときに、決めておく4つのこと',
    ]) {
      expect(section.getByRole('heading', { level: 3, name })).toBeInTheDocument();
    }
    expect(section.getAllByText('移したあとの形の例')).toHaveLength(2);
    expect(
      section.getByText('作った当社が、直し続ける体制まで用意します。どこまでお任せいただくかを、一緒に決めます。')
    ).toBeInTheDocument();
    expect(section.getByText(/^情報システム部門の方へ：/)).toBeInTheDocument();
    expect(section.getByText('守り方の進め方も、無料の個別相談でご相談いただけます。')).toBeInTheDocument();
    expect(section.getByRole('link', { name: '無料Web診断をはじめる' })).toHaveAttribute(
      'href',
      '#diagnosis'
    );
    // The column is about Access and PHP: not for readers of the host systems
    expect(section.queryByRole('link', { name: /PHP2shell/ })).toBeNull();
  });

  it('tells in the trust section that we keep fixing it after the move (#840)', async () => {
    await renderPage();
    const trust = within(
      screen.getByRole('heading', { level: 2, name: '安心して任せられる理由' }).closest('section') as HTMLElement
    );
    expect(trust.getByRole('heading', { level: 3, name: '移したあとも' })).toBeInTheDocument();
    expect(
      trust.getByText('作った当社が、弱点が見つかったときに直し続ける体制まで用意します。')
    ).toBeInTheDocument();
  });

  it('names the PrivacyMark and the ISMS certification with their numbers and scope (#842)', async () => {
    await renderPage();
    const trust = within(
      screen.getByRole('heading', { level: 2, name: '安心して任せられる理由' }).closest('section') as HTMLElement
    );
    expect(trust.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'セキュリティ',
      '対応範囲',
      'DX認定事業者',
      'プライバシーマーク',
      'ISMS（ISO/IEC 27001）',
      '移したあとも',
    ]);
    expect(trust.getByText(/認定番号：10822550、JIS Q 15001:2023 準拠/)).toBeInTheDocument();
    // The scope as the company profile states it, not tied to this migration work
    expect(
      trust.getByText(
        '情報セキュリティマネジメントシステムの認証（認証番号：IS609954）を取得しています。対象は、本社における業務系システム開発、教育研修サービス、HRコンサルティングです。'
      )
    ).toBeInTheDocument();
  });

  it('shows the booking button only when a booking URL is configured', async () => {
    render(withIntl(await resolveServerTree(await AxFinalCta({ locale: 'ja' }))));
    expect(screen.queryByRole('link', { name: /無料相談を予約する/ })).not.toBeInTheDocument();

    vi.stubEnv('NEXT_PUBLIC_AX_CONSULTATION_URL', 'https://bookings.example.com/ax');
    render(withIntl(await resolveServerTree(await AxFinalCta({ locale: 'ja' }))));
    const booking = screen.getByRole('link', { name: /無料相談を予約する/ });
    // Says it opens a new tab, as the demo buttons do (#420, #425)
    expect(booking).toHaveAccessibleName('無料相談を予約する（新しいタブで開きます）');
    expect(booking).toHaveAttribute('href', 'https://bookings.example.com/ax');
    expect(booking).toHaveAttribute('target', '_blank');
    expect(booking).toHaveAttribute('rel', 'noopener noreferrer');
  });
});

describe('AX migration landing page metadata', () => {
  it('names host systems, not Access: Access searches belong to the Access page (#332)', async () => {
    const metadata = await generateMetadata({ params: Promise.resolve({ locale: 'ja' }) });
    const title = 'AXマイグレーション｜AS/400・NEC ACOSなどの基幹システムをWebへ｜エス・エー・エス株式会社';
    expect(metadata.title).toEqual({ absolute: title });
    expect(metadata.description).toContain('AS/400（IBM i）やNEC ACOS');
    expect(metadata.openGraph?.title).toBe(title);
    expect(metadata.twitter?.title).toBe(title);
    expect(metadata.openGraph?.description).toBe(metadata.description);
    expect(metadata.twitter?.description).toBe(metadata.description);
    for (const text of [title, metadata.description ?? '']) expect(text).not.toMatch(/Access/);
    expect(metadata.alternates?.canonical).toBe('/ja/ax-migration');
  });

  it('shares a large image of the hero heading with an absolute URL (#344)', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://example.jp');
    const image = {
      url: 'https://example.jp/images/og/ax-migration-ja.png',
      width: 1200,
      height: 630,
      alt: '今の基幹システムのまま、AI時代の経営判断はできますか？',
    };
    const metadata = await generateMetadata({ params: Promise.resolve({ locale: 'ja' }) });
    // A page-level openGraph replaces the layout one: it keeps its own type and site name
    expect(metadata.openGraph).toMatchObject({
      type: 'website',
      siteName: 'エス・エー・エス株式会社',
      images: [image],
    });
    expect(metadata.twitter).toMatchObject({ card: 'summary_large_image', images: [image] });
    const english = await generateMetadata({ params: Promise.resolve({ locale: 'en' }) });
    expect(english.openGraph?.images).toEqual([
      expect.objectContaining({ url: 'https://example.jp/images/og/ax-migration-en.png' }),
    ]);
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
    expect(within(footer).getByRole('img', { name: 'まるマルDX AXマイグレーション' })).toBeInTheDocument();
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

  it('watches the hero diagnosis button, not the hero heading (#536)', () => {
    // Below the heading, the deadline tags put the hero buttons under a phone's first screen
    const observed: Element[] = [];
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe(target: Element) {
          observed.push(target);
        }
        disconnect() {}
      }
    );
    render(
      withIntl(
        <>
          <h1 id="ax-hero-heading">見出し</h1>
          <div id="ax-hero-cta">
            <a href="#diagnosis">無料Web診断をはじめる</a>
            <a href="https://example.com/booking">無料相談を予約する</a>
          </div>
          <AxFloatingCta label="かんたん無料診断をはじめる" />
        </>
      )
    );
    expect(observed).toEqual([screen.getByRole('link', { name: '無料Web診断をはじめる' })]);
  });

  it('counts the hero button only once most of it is on screen (#536)', () => {
    let callback: IntersectionObserverCallback = () => {};
    let options: IntersectionObserverInit | undefined;
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(cb: IntersectionObserverCallback, init?: IntersectionObserverInit) {
          callback = cb;
          options = init;
        }
        observe() {}
        disconnect() {}
      }
    );
    render(
      withIntl(
        <>
          <div id="ax-hero-cta">
            <a href="#diagnosis">無料Web診断をはじめる</a>
          </div>
          <AxFloatingCta label="かんたん無料診断をはじめる" />
        </>
      )
    );
    const bar = screen.getByText('かんたん無料診断をはじめる').closest('div') as HTMLElement;
    const target = screen.getByRole('link', { name: '無料Web診断をはじめる' });
    const show = (intersectionRatio: number) =>
      act(() =>
        callback(
          [{ target, isIntersecting: intersectionRatio > 0, intersectionRatio } as unknown as IntersectionObserverEntry],
          {} as IntersectionObserver
        )
      );
    expect(options?.threshold).toEqual([0, 0.75]);
    // 10px of an 84px button at the bottom edge: it cannot be read, the bar stays
    show(0.12);
    expect(bar).toHaveAttribute('aria-hidden', 'false');
    show(0.8);
    expect(bar).toHaveAttribute('aria-hidden', 'true');
  });

  it("stays hidden over the Access page's columns, below its last call to action (#537)", () => {
    const observed: Element[] = [];
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe(target: Element) {
          observed.push(target);
        }
        disconnect() {}
      }
    );
    render(
      withIntl(
        <>
          <section id="ax-final" />
          <section id="ax-access-columns" />
          <AxFloatingCta label="かんたん無料診断をはじめる" />
        </>
      )
    );
    expect(observed.map((target) => target.id)).toEqual(['ax-final', 'ax-access-columns']);
  });
});

describe('AS/400 and ACOS sections of the landing page (#311)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.mocked(Element.prototype.scrollIntoView).mockClear();
  });

  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  const section = (id: string) => document.getElementById(id) as HTMLElement;
  const startButton = (id: string) => within(section(id)).getByRole('link', { name: /無料Web診断をはじめる/ });

  it('gives each platform its own heading, triggers and checks after the targets', async () => {
    await renderPage();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    const targets = screen.getByRole('heading', { level: 2, name: '対象となるシステム' });
    for (const [id, name] of [
      ['as400-migration', 'AS/400（IBM i）からの移行を考えている方へ'],
      ['acos-migration', 'NEC ACOSからの移行を考えている方へ'],
    ]) {
      const heading = within(section(id)).getByRole('heading', { level: 2, name });
      expect(section(id)).toHaveAccessibleName(name);
      expect(targets.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(within(section(id)).getAllByRole('listitem')).toHaveLength(4);
      // The one date is the one the diagnosis itself states (legacy_edi)
      expect(within(section(id)).getByText(/INSネットの提供を2028年12月31日で終える/)).toBeInTheDocument();
      // Without a script the button still leads to the diagnosis
      expect(startButton(id)).toHaveAttribute('href', '#diagnosis');
    }
    expect(within(section('as400-migration')).getByText(/RPG・COBOL・CL/)).toBeInTheDocument();
    expect(within(section('acos-migration')).getByText(/ETOS/)).toBeInTheDocument();
  });

  it.each([
    ['as400-migration', 'as400', /STEP 2 \/ 6\s*運用と期限/],
    ['acos-migration', 'acos', /STEP 2 \/ 6\s*機種と運用/],
  ])('starts the embedded diagnosis on the platform of %s', async (id, platform, step) => {
    const user = userEvent.setup();
    await renderPage();
    const diagnosis = section('diagnosis');

    await user.click(startButton(id));

    const heading = within(diagnosis).getByRole('heading', { name: step });
    expect(heading).toHaveFocus();
    expect(within(diagnosis).queryByTestId(`platform-${platform}`)).not.toBeInTheDocument();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    // A step entry of its own, without the link's #diagnosis in between
    expect(window.history.state.ax.step).toBe(1);
    expect(window.location.hash).toBe('');

    // The back button leads to the path choice, with the platform chosen
    await user.click(within(diagnosis).getByRole('button', { name: /戻る/ }));
    expect(await within(diagnosis).findByTestId(`platform-${platform}`)).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(window.history.state.ax.step).toBe(0);
  });

  it('keeps a diagnosis already under way', async () => {
    const user = userEvent.setup();
    await renderPage();
    const diagnosis = section('diagnosis');
    await user.click(within(diagnosis).getByTestId('platform-acos'));
    vi.mocked(Element.prototype.scrollIntoView).mockClear();

    await user.click(startButton('as400-migration'));

    expect(within(diagnosis).getByRole('heading', { name: /STEP 2 \/ 6\s*機種と運用/ })).toBeInTheDocument();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    expect(window.location.hash).toBe('');
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
    as400: document.getElementById('as400-migration'),
    acos: document.getElementById('acos-migration'),
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
    // The host platform sections belong to the landing page only (#311)
    expect(document.getElementById('as400-migration')).toBeNull();
    expect(document.getElementById('acos-migration')).toBeNull();
  });
});

describe('AX header navigation (#324)', () => {
  it('links to the column list in Japanese', async () => {
    await renderPage();
    const nav = screen.getByRole('navigation', { name: 'ページ内のメニュー' });
    expect(within(nav).getByRole('link', { name: 'コラム' })).toHaveAttribute(
      'href',
      '/ja/ax-migration/column'
    );
  });

  it('has no column link on the English page, where no column exists', async () => {
    const { AxSiteHeader } = await import('@/components/features/ax-site/ax-site-header');
    const enMessages = (await import('@/locales/en/common.json')).default;
    render(
      <NextIntlClientProvider locale="en" messages={enMessages} timeZone="Asia/Tokyo">
        {await AxSiteHeader({ locale: 'en', variant: 'landing' })}
      </NextIntlClientProvider>
    );
    const hrefs = screen.getAllByRole('link').map((link) => link.getAttribute('href') ?? '');
    expect(hrefs.length).toBeGreaterThan(0);
    expect(hrefs.some((href) => href.includes('/column'))).toBe(false);
  });
});
