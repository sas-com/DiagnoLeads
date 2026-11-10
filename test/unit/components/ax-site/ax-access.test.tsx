/**
 * Access landing page (#296): server components rendered with the real messages, fetch mocked
 */
import { evaluateAxMigration, toPublicResult } from '@/lib/features/diagnostics/ax-migration/evaluate';
import { axMigrationDefinition } from '@/lib/features/diagnostics/ax-migration/definition';
import messages from '@/locales/ja/common.json';
import { accessAnswers } from '@/test/fixtures/ax-migration';
import { render, screen, waitFor, within } from '@testing-library/react';
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

const { default: AxAccessPage, generateMetadata } = await import(
  '@/app/[locale]/(ax)/ax-migration/access/page'
);
const { default: AxMigrationPage } = await import('@/app/[locale]/(ax)/ax-migration/page');

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  window.scrollTo = vi.fn() as typeof window.scrollTo;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({
    ok: true,
    status: 201,
    headers: new Headers(),
    json: async () => ({
      submissionId: 'sub-1',
      consultationRequested: false,
      result: toPublicResult(evaluateAxMigration(accessAnswers)),
    }),
  } as Response);
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
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

const withIntl = (ui: ReactNode) => (
  <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
    {ui}
  </NextIntlClientProvider>
);

const params = Promise.resolve({ locale: 'ja' });
const renderPage = async () =>
  render(withIntl(await resolveServerTree(await AxAccessPage({ params }))));

type User = ReturnType<typeof userEvent.setup>;
const inGroup = (name: RegExp) => within(screen.getByRole('group', { name }));
const next = (user: User) => user.click(screen.getByRole('button', { name: /次へ/ }));
const diagnosis = () => document.getElementById('diagnosis') as HTMLElement;

/** The Access questions, from the first one (the platform question is skipped) */
async function answerAccess(user: User) {
  await user.click(inGroup(/直せる（変更できる）人/).getByLabelText(/直せる人がいない/));
  await user.click(inGroup(/お使いのAccess/).getByLabelText('2016・2019'));
  await next(user);
  await user.click(inGroup(/ツール（業務）はいくつ/).getByLabelText('2〜5'));
  await user.click(inGroup(/画面と帳票/).getByLabelText('20〜50'));
  await user.click(inGroup(/このツールで当てはまるもの/).getByLabelText(/ボタン一つで/));
  await next(user);
  await user.click(inGroup(/いま感じている課題/).getByLabelText(/同時に使えない/));
  await user.click(inGroup(/切り替えを目指す時期/).getByLabelText('1年以内'));
  await user.click(inGroup(/業種/).getByLabelText('製造業'));
  await user.click(inGroup(/あなたの立場/).getByLabelText(/業務部門の責任者/));
  await next(user);
  // Company size (#150) is optional
  await next(user);
  await user.type(screen.getByLabelText(/会社名/), '三田製作所');
  await user.type(screen.getByLabelText(/お名前/), '山田 太郎');
  await user.type(screen.getByLabelText(/会社のメールアドレス/), 'yamada@example.jp');
  await user.click(screen.getByLabelText('個人情報の取り扱いに同意する'));
  await user.click(screen.getByRole('button', { name: /診断結果を見る/ }));
  return screen.findByRole('heading', { name: '診断結果' });
}

describe('Access landing page', () => {
  it('has the headline, every section in order and the trademark notice', async () => {
    await renderPage();

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(
      screen.getByRole('heading', { level: 1, name: 'その Access、直して使うか、Web に移すか。' })
    ).toBeInTheDocument();
    const h2s = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(h2s).toEqual([
      'Access のサポート終了',
      'こんなとき、ありませんか',
      'そのままにしたときのリスク',
      '進め方は、3つあります',
      // After the three ways: what choosing the web means for protecting the tool (#839, #838)
      '今の Access と、Web に移すときに作れること',
      'Web システムにしても、インターネットに公開するとは限りません',
      // The steps start with the free check (#425)
      '無料Web診断からの流れ',
      // The phone halfway down, as on the main page, in this page's words (#425)
      '直すか、Web に移すか。迷ったら、ご相談ください',
      '対象になる Access',
      'AS/400・ACOS など基幹システムの移行をお考えの方へ',
      'よくある質問',
      // Reassurance right before the diagnosis asks for contact details (#425)
      '安心して任せられる理由',
      '無料Web診断（Access版）',
      'まずは、お使いの Access を確かめるところから。',
      // After the last call to action, not right before the diagnosis (#332)
      'Access の移行に関するコラム',
    ]);
    for (const name of ['直して使い続ける', 'Web に移す', '既製サービスに置き換える']) {
      expect(screen.getByRole('heading', { level: 3, name })).toBeInTheDocument();
    }
    // The header anchors of the site lead to this page's sections; its approach is the three
    // ways (#537)
    for (const id of ['problems', 'paths', 'targets', 'faq', 'diagnosis']) {
      expect(document.getElementById(id), id).not.toBeNull();
    }
    // The AS/400 and ACOS sections are the main page's (#311)
    expect(document.getElementById('as400-migration')).toBeNull();
    expect(document.getElementById('acos-migration')).toBeNull();
    expect(screen.getByText(/2025年10月14日/)).toBeInTheDocument();
    expect(screen.getByText(/2026年10月13日/)).toBeInTheDocument();
    expect(screen.getByText(/出典：Microsoft のライフサイクル情報/)).toBeInTheDocument();
    expect(screen.getByText(/PDF で保存でき/)).toBeInTheDocument();
    expect(screen.getByText(/米国 Microsoft Corporation の米国およびその他の国/)).toBeInTheDocument();
  });

  it('says the check gives a guide to the path that fits, decided together (#303)', async () => {
    await renderPage();
    expect(
      screen.getByText(
        // The questions asked before the result; the number of users comes after it (#537)
        '版や VBA、画面・帳票の数などを選ぶと、ツールに合った進め方の目安が分かります。直して使うか、Web に移すか、置き換えるか、合うものをお伝えします。'
      )
    ).toBeInTheDocument();
    expect(screen.getByText(/無料Web診断で、どれが合うかの目安が分かります。進め方は、相談のうえで一緒に決めます。/)).toBeInTheDocument();
    // The diagnosis intro (the first of the steps says the same, #425)
    expect(
      within(diagnosis()).getByText(/おすすめの進め方（直す・Web に移す・置き換える）の目安/)
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'どれが合うか、無料Web診断で確かめる' })
    ).toHaveAttribute('href', '#diagnosis');
    // Never promises that a web system is safe, and the old wording is gone
    expect(document.body).not.toHaveTextContent(/Web 化すれば安全|Web に移せば安全/);
    expect(screen.queryByText(/移行の難しさと急ぎ度合いの目安が分かります。直して使うか/)).toBeNull();

    const metadata = await generateMetadata({ params });
    expect(metadata.description).toContain('ツールに合った進め方の目安が分かります');
    expect(metadata.description).toContain('画面・帳票の数');
    expect(metadata.description).not.toContain('利用人数');
  });

  it('keeps the three ways of the hero beside its copy, not below the phone buttons (#537)', async () => {
    await renderPage();
    const hero = screen.getByRole('heading', { level: 1 }).closest('section') as HTMLElement;
    const ways = within(hero).getByText('進め方は3つ').parentElement as HTMLElement;
    expect(ways).toHaveClass('hidden', 'lg:block');
  });

  it('answers whether someone outside IT can answer, as the main page does (#537)', async () => {
    await renderPage();
    const faq = document.getElementById('faq') as HTMLElement;
    const questions = [...faq.querySelectorAll('summary')].map((summary) =>
      summary.textContent?.replace(/^Q/, '')
    );
    expect(questions.at(-2)).toBe('情報システムの担当者でなくても答えられますか？');
    expect(questions.at(-1)).toBe('相談はどのように進みますか？');
    expect(
      within(faq).getByText('はい。すべて選択式で、わからない質問は「わからない」を選べます。詳しい質問は任意です。')
    ).toBeInTheDocument();
  });

  it('points the diagnosis buttons at the embedded diagnosis', async () => {
    await renderPage();
    const buttons = screen.getAllByRole('link', { name: /無料Web診断/ });
    expect(buttons.length).toBeGreaterThanOrEqual(3);
    for (const button of buttons) expect(button).toHaveAttribute('href', '#diagnosis');
  });

  it('keeps the phone bar to the short label of the main page, on one line (#672)', async () => {
    await renderPage();
    // With "（Access版）" it took two lines from 375px wide; the page says it is the Access check
    const bar = screen.getByTestId('ax-floating-cta');
    expect(bar).toHaveTextContent(/^無料Web診断をはじめる$/);
    expect(within(bar).getByRole('link', { hidden: true })).toHaveAttribute('href', '#diagnosis');
  });

  it('names what brings an Access tool up for review, above the hero buttons (#425)', async () => {
    await renderPage();
    const hero = screen.getByRole('heading', { level: 1 }).closest('section') as HTMLElement;
    const triggers = within(hero).getByText('こんなきっかけはありませんか')
      .nextElementSibling as HTMLElement;
    expect(within(triggers).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Access 2016・2019・2021 のサポート終了',
      '作った人の異動・退職',
      'Microsoft 365・64bit 版への切り替え',
    ]);
    // The phone CTA bar watches the buttons on their own, as on the main page (#420)
    const buttons = document.getElementById('ax-hero-cta') as HTMLElement;
    expect(hero).toContainElement(buttons);
    expect(
      within(buttons).getByRole('link', { name: /無料Web診断（Access版）をはじめる/ })
    ).toHaveAttribute('href', '#diagnosis');
    // Not the caption above them, which can be on screen while the buttons are not (#536)
    expect(buttons).not.toHaveTextContent('無料・選択式・約3分');
  });

  it('starts the steps with the free check, as on the main page (#425)', async () => {
    await renderPage();
    const steps = within(document.getElementById('steps') as HTMLElement)
      .getAllByRole('heading', { level: 3 })
      .map((heading) => heading.textContent);
    expect(steps).toEqual(['無料Web診断（Access版・約3分）', '棚卸し', '進め方の決定', '移行', 'AX化']);
    // The inventory is not called free: a cost for checking the files is said beforehand (#538)
    expect(
      within(document.getElementById('steps') as HTMLElement).getByText(
        /ファイルを確かめる作業に費用がかかる場合は、前もってお伝えします。$/
      )
    ).toBeInTheDocument();
  });

  it('answers the worry about moving to the web near the top, in the reader\'s words (#466, #841)', async () => {
    await renderPage();
    const faq = document.getElementById('faq') as HTMLElement;
    const questions = [...faq.querySelectorAll('summary')].map((summary) =>
      summary.textContent?.replace(/^Q/, '')
    );
    expect(questions.slice(0, 4)).toEqual([
      '仕様書がありません。相談できますか？',
      '社内だけで使っていたシステムを Web にして、セキュリティは大丈夫ですか？',
      '社外から使えるようにしなくても、Web に移せますか？',
      '情報システム部門の審査に向けて、説明してもらえますか？',
    ]);
    expect(questions).toContain('個人情報が入っていても、相談できますか？');
    const answer = within(faq).getByText(/^ご心配はもっともです。/);
    expect(answer).toHaveTextContent('進め方を決めるときに一緒に決めます。');
    expect(answer).toHaveTextContent('直し続ける体制まで、作った当社が用意します。');
    expect(answer).toHaveTextContent('サポートが終わった版の Access は、弱点が見つかっても直されません。');
    // The follow-up of the diagnosis asks the kinds of data (#826)
    expect(within(faq).getByText(/^はい。どんな情報が入っているかを最初に伺い/)).toHaveTextContent(
      '無料Web診断の詳しい質問でも、入っている情報の種類を選べます。'
    );
  });

  it('compares today\'s Access with what can be built on the web, without blaming its users (#839)', async () => {
    await renderPage();
    const heading = screen.getByRole('heading', {
      level: 2,
      name: '今の Access と、Web に移すときに作れること',
    });
    const paths = screen.getByRole('heading', { level: 2, name: '進め方は、3つあります' });
    expect(paths.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const section = within(heading.closest('section') as HTMLElement);
    expect(section.getByText('一人に頼る、から、体制で支えるへ')).toBeInTheDocument();
    expect(section.getByText(/使い方の問題ではありません。$/)).toBeInTheDocument();
    const rows = section.getAllByRole('row').slice(1);
    expect(rows.map((row) => within(row).getByRole('rowheader').textContent)).toEqual([
      '直せる人',
      'データの持ち出し',
      '記録',
      '辞めた人・異動した人',
      'バックアップ',
      '弱点が見つかったとき',
    ]);
    expect(within(rows[0]).getByText('作った当社が、直し続ける体制まで用意します。')).toBeInTheDocument();
    // Microsoft 365 keeps getting fixes: only the versions whose support has ended are not fixed
    expect(within(rows[5]).getByText(/Microsoft 365 の Access は更新が続きます。/)).toBeInTheDocument();
    // The same things are decided on every way, not only on the web
    expect(
      section.getByText(/直して使い続けるときも、既製サービスに置き換えるときも、同じことを決めておきます。$/)
    ).toBeInTheDocument();
  });

  it('says where the web system is reached from, and links the column on protecting it (#838, #840)', async () => {
    await renderPage();
    const heading = screen.getByRole('heading', {
      level: 2,
      name: 'Web システムにしても、インターネットに公開するとは限りません',
    });
    const section = within(heading.closest('section') as HTMLElement);
    expect(section.getByRole('heading', { level: 3, name: 'Web に移すときに、決めておく4つのこと' })).toBeInTheDocument();
    expect(section.getByText('社内の共有フォルダや、決まった PC から使っています。')).toBeInTheDocument();
    // The name of the consultation and what is free stay as decided (#538, #467)
    expect(
      section.getByText('守り方の進め方も、30分の無料オンライン相談でご相談いただけます。')
    ).toBeInTheDocument();
    expect(section.getByRole('link', { name: '無料Web診断（Access版）をはじめる' })).toHaveAttribute(
      'href',
      '#diagnosis'
    );
    expect(section.getByRole('link', { name: /PHP2shell/ })).toHaveAttribute(
      'href',
      '/ja/ax-migration/column/access-web-security'
    );
    // The trust section, shared with the main page, says it too
    const trust = within(
      screen.getByRole('heading', { level: 2, name: '安心して任せられる理由' }).closest('section') as HTMLElement
    );
    expect(trust.getByRole('heading', { level: 3, name: '移したあとも' })).toBeInTheDocument();
  });

  it('says the 30-minute online consultation is free, as the main page and the result do (#467)', async () => {
    await renderPage();
    const faq = within(document.getElementById('faq') as HTMLElement);
    expect(
      faq.getByText(/^30分の無料オンライン相談が基本です。内容に応じて、エンジニアも同席します。/)
    ).toBeInTheDocument();
    expect(faq.getByText(/無料Web診断と30分のオンライン相談に、費用はかかりません。$/)).toBeInTheDocument();
  });

  it('puts the phone halfway down and at the end, and the reassurance before the diagnosis (#425)', async () => {
    window.history.replaceState(null, '', '/ja/ax-migration/access');
    const analytics = window as Window & { dataLayer?: unknown[] };
    analytics.dataLayer = [];
    const user = userEvent.setup();
    await renderPage();

    const emails = screen.getAllByRole('link', { name: 'dx-agency@sas-com.com' });
    const phones = screen.getAllByRole('link', { name: '03-5427-3663' });
    expect(emails).toHaveLength(2);
    expect(phones).toHaveLength(2);
    for (const phone of phones) expect(phone).toHaveAttribute('href', 'tel:+81354273663');

    // The band names this page's diagnosis and reports its own place
    const band = within(document.getElementById('ax-consult') as HTMLElement);
    // With no booking page, the band still says that the 30-minute consultation is free (#467)
    expect(band.queryByRole('link', { name: /予約する/ })).toBeNull();
    expect(
      band.getByText('30分の無料オンライン相談は、お電話・メールでもお申し込みいただけます。')
    ).toBeInTheDocument();
    await user.click(band.getByRole('link', { name: /無料Web診断（Access版）をはじめる/ }));
    expect(analytics.dataLayer).toContainEqual({
      event: 'ax_lp_cta_click',
      cta: 'diagnosis',
      location: 'access-consult-band',
      page: 'ax-access-lp',
    });
    analytics.dataLayer = undefined;

    const trust = screen.getByRole('heading', { level: 2, name: '安心して任せられる理由' });
    const diagnosis = screen.getByRole('heading', { level: 2, name: '無料Web診断（Access版）' });
    expect(trust.compareDocumentPosition(diagnosis) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The scope card speaks of Access work, not of the host systems listed on the main page
    const trustSection = within(trust.closest('section') as HTMLElement);
    expect(
      trustSection.getByText(
        '直す・Web に移す・置き換える、どの進め方もご相談いただけます。1つの部署の、1つのツールからお受けします。'
      )
    ).toBeInTheDocument();
    expect(trustSection.queryByText(/AS\/400/)).toBeNull();
    expect(trustSection.getByText(/学習データとして利用されない/)).toBeInTheDocument();
  });

  it('says which links open a new tab: the booking and the Microsoft sources', async () => {
    vi.stubEnv('NEXT_PUBLIC_AX_CONSULTATION_URL', 'https://bookings.example.com/ax');
    await renderPage();
    // In the hero, the consultation band and the final call to action
    const bookings = screen.getAllByRole('link', { name: /30分の無料オンライン相談を予約する/ });
    expect(bookings).toHaveLength(3);
    for (const booking of bookings) {
      expect(booking).toHaveAccessibleName('30分の無料オンライン相談を予約する（新しいタブで開きます）');
      expect(booking).toHaveAttribute('href', 'https://bookings.example.com/ax');
      expect(booking).toHaveAttribute('target', '_blank');
    }
    for (const number of [1, 2]) {
      expect(
        screen.getByRole('link', { name: `Microsoft の公開情報 ${number}（新しいタブで開きます）` })
      ).toHaveAttribute('target', '_blank');
    }
  });

  it('has its own canonical address, the operator site and no index in test mode', async () => {
    vi.stubEnv('APP_TEST_MODE', 'true');
    const metadata = await generateMetadata({ params });
    expect(metadata.alternates?.canonical).toBe('/ja/ax-migration/access');
    expect(metadata.alternates?.languages).toEqual({
      ja: '/ja/ax-migration/access',
      en: '/en/ax-migration/access',
    });
    expect(metadata.openGraph?.siteName).toBe('エス・エー・エス株式会社');
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it('shares a large image of the hero heading with an absolute URL (#344)', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://example.jp');
    const image = {
      url: 'https://example.jp/images/og/ax-access-ja.png',
      width: 1200,
      height: 630,
      alt: 'その Access、直して使うか、Web に移すか。',
    };
    const metadata = await generateMetadata({ params });
    expect(metadata.openGraph).toMatchObject({ type: 'website', images: [image] });
    expect(metadata.twitter).toMatchObject({ card: 'summary_large_image', images: [image] });
  });

  it('starts the diagnosis on the Access questions, without the platform question', async () => {
    const user = userEvent.setup();
    await renderPage();
    const embedded = within(diagnosis());

    expect(embedded.queryByTestId('platform-as400')).not.toBeInTheDocument();
    expect(embedded.getByRole('group', { name: /直せる（変更できる）人/ })).toBeInTheDocument();
    expect(embedded.getByRole('group', { name: /お使いのAccess/ })).toBeInTheDocument();
    expect(embedded.getByText('STEP 1 / 5')).toBeInTheDocument();
    // Answers of the preset path alone are not saved (a saved diagnosis is kept)
    expect(window.localStorage.getItem('diagnoleads:ax-diagnosis')).toBeNull();

    // Back leads to the path choice, with Access chosen
    await user.click(embedded.getByRole('button', { name: /戻る/ }));
    expect(embedded.getByTestId('platform-access')).toHaveAttribute('aria-pressed', 'true');
    expect(embedded.getByText('STEP 1 / 6')).toBeInTheDocument();
    await user.click(embedded.getByTestId('platform-access'));
    expect(embedded.getByRole('group', { name: /直せる（変更できる）人/ })).toBeInTheDocument();
    expect(embedded.getByText('STEP 2 / 6')).toBeInTheDocument();
  });

  it('offers to continue only a saved diagnosis of the Access path', async () => {
    const save = (answers: Record<string, string>) =>
      window.localStorage.setItem(
        'diagnoleads:ax-diagnosis',
        JSON.stringify({ version: axMigrationDefinition.version, savedAt: Date.now(), step: 1, answers })
      );
    save({ platform: 'as400', maintenance: 'few' });
    const first = await renderPage();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole('button', { name: '続きから' })).not.toBeInTheDocument();
    first.unmount();

    save({ platform: 'access', access_maintainer: 'nobody' });
    await renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: '続きから' }));
    expect(inGroup(/直せる（変更できる）人/).getByLabelText(/直せる人がいない/)).toBeChecked();
  });

  it(
    'records the page as the entry and shows only the result (#280)',
    { timeout: 30000 },
    async () => {
      // Arrived from the main page's Access card (#332)
      window.history.replaceState(null, '', '/?from=ax-lp-targets-access');
      const analytics = window as Window & { dataLayer?: unknown[] };
      analytics.dataLayer = [];
      const user = userEvent.setup();
      await renderPage();
      const heading = await answerAccess(user);

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.answers.platform).toBe('access');
      expect(body.tracking.entry).toBe('ax-access-lp');
      expect(body.tracking.from).toBe('ax-lp-targets-access');
      expect(body.tracking.landingPath).toBe('/');
      // The funnel events name the page the diagnosis was started from and the link that led there
      const sent = (analytics.dataLayer ?? []) as { event?: string; entry?: string; from?: string }[];
      for (const name of ['ax_diagnosis_start', 'ax_diagnosis_step', 'ax_diagnosis_complete']) {
        const found = sent.filter((entry) => entry.event === name);
        expect(found.length, name).toBeGreaterThan(0);
        for (const event of found) {
          expect(event.entry, name).toBe('ax-access-lp');
          expect(event.from, name).toBe('ax-lp-targets-access');
        }
      }
      analytics.dataLayer = undefined;

      // The result replaces the page: one h1, without the other sections
      expect(screen.getAllByRole('heading', { level: 1 })).toEqual([heading]);
      expect(document.getElementById('ax-hero-heading')).toBeNull();
      expect(document.getElementById('faq')).toBeNull();
      expect(document.getElementById('ax-final')).toBeNull();
      // The links to the other pages (#332) leave with the sections
      expect(screen.queryByRole('navigation', { name: 'パンくずリスト' })).toBeNull();
      expect(document.getElementById('ax-access-hosts-heading')).toBeNull();
      expect(document.getElementById('ax-access-columns-heading')).toBeNull();
      expect(screen.queryByRole('link', { name: /Access を直すか、Web に移すか/ })).toBeNull();
      expect(screen.queryByText('Access 以外のシステムは「戻る」から選び直せます。')).toBeNull();
      expect(diagnosis()).toContainElement(heading);
      // The step entries are rewound to the page's own entry
      await waitFor(() => expect(window.history.state.ax.step).toBe(1));

      // A section of the phone menu brings the page back, as the header links do (#332)
      await user.click(screen.getByRole('button', { name: 'メニュー' }));
      await user.click(
        within(screen.getByRole('navigation', { name: 'サイト内のメニュー' })).getByRole('link', {
          name: 'よくある質問',
        })
      );
      expect(document.getElementById('faq')).not.toBeNull();
      expect(screen.getByRole('button', { name: 'メニュー' })).toHaveAttribute('aria-expanded', 'false');

      // Another system starts from the path choice, with the page back
      await user.click(screen.getByRole('button', { name: '別のシステムも診断する' }));
      expect(document.getElementById('ax-hero-heading')).not.toBeNull();
      expect(within(diagnosis()).getByTestId('platform-as400')).toBeInTheDocument();
      expect(within(diagnosis()).getByText('STEP 1 / 6')).toBeInTheDocument();
    }
  );
});

describe('Main landing page', () => {
  it('links the Access item to the Access landing page', async () => {
    render(withIntl(await resolveServerTree(await AxMigrationPage({ params }))));
    const access = screen
      .getByRole('heading', { level: 3, name: 'Microsoft Access' })
      .closest('li') as HTMLElement;
    expect(
      within(access).getByRole('link', {
        name: 'Access の3つの道（直す・Web に移す・置き換える）を詳しく見る',
      })
    ).toHaveAttribute('href', '/ja/ax-migration/access');
  });
});
