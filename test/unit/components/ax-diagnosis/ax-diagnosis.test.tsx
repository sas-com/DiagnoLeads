/**
 * AX migration diagnosis v2 components (real next-intl messages, fetch mocked)
 */
import { AxDiagnosisFlow } from '@/components/features/ax-diagnosis/ax-diagnosis-flow';
import { AxDiagnosisResult } from '@/components/features/ax-diagnosis/ax-diagnosis-result';
import { LOAD_TIMEOUT_MS } from '@/components/features/diagnosis-runner/turnstile-widget';
import { axMigrationDefinition } from '@/lib/features/diagnostics/ax-migration/definition';
import { evaluateAxMigration, toPublicResult } from '@/lib/features/diagnostics/ax-migration/evaluate';
import messages from '@/locales/ja/common.json';
import { accessAnswers, as400Answers } from '@/test/fixtures/ax-migration';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

const withIntl = (ui: ReactNode) => (
  <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
    {ui}
  </NextIntlClientProvider>
);

const publicResult = toPublicResult(
  evaluateAxMigration({ ...as400Answers, source_docs: 'source_missing' })
);

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  window.localStorage.clear();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

const jsonResponse = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: async () => body,
  }) as Response;

type User = ReturnType<typeof userEvent.setup>;

const next = (user: User) => user.click(screen.getByRole('button', { name: /次へ/ }));
const inGroup = (name: RegExp) => within(screen.getByRole('group', { name }));

async function answerAs400(user: User) {
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
  // Company size (#150): optional, so the respondent may go on without answering
  await next(user);
}

async function fillContact(user: User) {
  await user.type(screen.getByLabelText(/会社名/), '三田製作所');
  await user.type(screen.getByLabelText(/お名前/), '山田 太郎');
  await user.type(screen.getByLabelText(/会社のメールアドレス/), 'yamada@example.jp');
  await user.click(screen.getByLabelText('個人情報の取り扱いに同意する'));
}

describe('AxDiagnosisFlow', () => {
  it('starts with the migration path and moves on when one is chosen', async () => {
    const user = userEvent.setup();
    render(withIntl(<AxDiagnosisFlow locale="ja" />));

    expect(screen.getByText('当てはまるものを選ぶと、次の質問に進みます。')).toBeInTheDocument();
    expect(screen.getByText('STEP 1 / 6')).toBeInTheDocument();
    for (const id of ['as400', 'acos', 'access', 'other']) {
      expect(screen.getByTestId(`platform-${id}`)).toBeInTheDocument();
    }

    await user.click(screen.getByTestId('platform-acos'));
    const heading = screen.getByRole('heading', { name: /STEP 2 \/ 6\s*機種と運用/ });
    expect(heading).toHaveFocus();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('starts on the path chosen by the page and still lets the respondent change it (#296)', async () => {
    const user = userEvent.setup();
    render(withIntl(<AxDiagnosisFlow locale="ja" initialPlatform="access" />));
    expect(screen.queryByTestId('platform-access')).not.toBeInTheDocument();
    expect(screen.getByText('STEP 1 / 5')).toBeInTheDocument();
    expect(window.history.state.ax.step).toBe(1);

    await user.click(inGroup(/直せる（変更できる）人/).getByLabelText(/直せる人がいない/));
    await user.click(inGroup(/お使いのAccess/).getByLabelText('2016・2019'));
    await next(user);
    expect(screen.getByRole('heading', { name: /STEP 2 \/ 5/ })).toHaveFocus();

    // The back button walks the history entries, then reaches the path choice in place
    await user.click(screen.getByRole('button', { name: /戻る/ }));
    expect(await screen.findByRole('heading', { name: /STEP 1 \/ 5/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /戻る/ }));
    expect(screen.getByTestId('platform-access')).toHaveAttribute('aria-pressed', 'true');
    expect(window.history.state.ax.step).toBe(0);
    // Another path drops the Access answers, as on the main page
    await user.click(screen.getByTestId('platform-as400'));
    expect(screen.getByRole('heading', { name: /STEP 2 \/ 6/ })).toBeInTheDocument();
  });

  it('ignores a path the diagnosis does not have', () => {
    render(withIntl(<AxDiagnosisFlow locale="ja" initialPlatform="unknown" />));
    expect(screen.getByTestId('platform-as400')).toBeInTheDocument();
    expect(screen.getByText('STEP 1 / 6')).toBeInTheDocument();
  });

  it('names the unanswered questions', async () => {
    const user = userEvent.setup();
    render(withIntl(<AxDiagnosisFlow locale="ja" />));
    await user.click(screen.getByTestId('platform-as400'));
    await next(user);

    // Shown under each question (and repeated for screen readers in the legend)
    expect(document.getElementById('q-maintenance-error')).toHaveTextContent(
      'いずれか1つを選んでください'
    );
    // The group name carries the error once (no repeat through aria-describedby)
    const group = screen.getByRole('group', { name: /直せる（改修できる）人/ });
    expect(group).toHaveAccessibleName(/いずれか1つを選んでください/);
    expect(group.getAttribute('aria-describedby') ?? '').not.toContain('error');
    expect(document.querySelectorAll('p[id^="q-"][id$="-error"]')).toHaveLength(3);
    expect(screen.getByRole('heading', { name: /STEP 2 \/ 6/ })).toBeInTheDocument();
  });

  it('asks the Access questions in the words of the department', async () => {
    const user = userEvent.setup();
    render(withIntl(<AxDiagnosisFlow locale="ja" />));
    await user.click(screen.getByTestId('platform-access'));

    expect(screen.getByRole('group', { name: /直せる（変更できる）人/ })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /お使いのAccess/ })).toBeInTheDocument();
    // Follow-up questions are not part of the diagnosis itself
    expect(screen.queryByRole('group', { name: /データはどこに置いて/ })).not.toBeInTheDocument();
  });

  it('clears the other choices for an exclusive option and says so', async () => {
    const user = userEvent.setup();
    render(withIntl(<AxDiagnosisFlow locale="ja" />));
    await user.click(screen.getByTestId('platform-as400'));
    await user.click(inGroup(/直せる（改修できる）人/).getByLabelText(/社内に3名以上/));
    await user.click(inGroup(/保守期限/).getByLabelText('3年以上先'));
    await user.click(inGroup(/データのやり取り/).getByLabelText('ほとんどない（0〜2）'));
    await next(user);

    const languages = inGroup(/どんな言語・方法/);
    await user.click(languages.getByLabelText('COBOL'));
    await user.click(languages.getByLabelText('わからない'));
    expect(languages.getByLabelText('COBOL')).not.toBeChecked();
    expect(languages.getByLabelText('わからない')).toBeChecked();
    expect(screen.getByText('ほかの選択を外しました')).toBeInTheDocument();
  });

  it('drops the answers of a path when another one is chosen', async () => {
    const user = userEvent.setup();
    render(withIntl(<AxDiagnosisFlow locale="ja" />));
    await user.click(screen.getByTestId('platform-as400'));
    await user.click(inGroup(/直せる（改修できる）人/).getByLabelText(/社内に3名以上/));
    await user.click(screen.getByRole('button', { name: /戻る/ }));
    expect(screen.getByTestId('platform-as400')).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByTestId('platform-acos'));
    // The same question on the ACOS path keeps its answer
    expect(inGroup(/直せる（改修できる）人/).getByLabelText(/社内に3名以上/)).toBeChecked();
    await user.click(screen.getByRole('button', { name: /戻る/ }));
    await user.click(screen.getByTestId('platform-access'));
    const saved = JSON.parse(window.localStorage.getItem('diagnoleads:ax-diagnosis') ?? '{}');
    expect(saved.answers).toEqual({ platform: 'access' });
  });

  it('offers to continue a diagnosis saved in this browser', async () => {
    window.localStorage.setItem(
      'diagnoleads:ax-diagnosis',
      JSON.stringify({
        version: axMigrationDefinition.version,
        savedAt: Date.now(),
        step: 2,
        answers: { platform: 'as400', maintenance: 'few', support_end: '1_3y', integrations: 'some' },
      })
    );
    const user = userEvent.setup();
    render(withIntl(<AxDiagnosisFlow locale="ja" />));

    await user.click(await screen.findByRole('button', { name: '続きから' }));
    expect(screen.getByRole('heading', { name: /STEP 3 \/ 6\s*規模と作り/ })).toBeInTheDocument();
  });

  it('ignores saved answers older than a week', async () => {
    window.localStorage.setItem(
      'diagnoleads:ax-diagnosis',
      JSON.stringify({
        version: axMigrationDefinition.version,
        savedAt: Date.now() - 8 * 24 * 60 * 60 * 1000,
        step: 1,
        answers: { platform: 'as400' },
      })
    );
    render(withIntl(<AxDiagnosisFlow locale="ja" />));
    await waitFor(() => expect(window.localStorage.getItem('diagnoleads:ax-diagnosis')).toBeNull());
    expect(screen.queryByRole('button', { name: '続きから' })).not.toBeInTheDocument();
  });

  it('asks for the phone number only when a consultation is wanted', async () => {
    const user = userEvent.setup();
    render(withIntl(<AxDiagnosisFlow locale="ja" />));
    await answerAs400(user);

    expect(screen.getByRole('heading', { name: /最後に、ご連絡先/ })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /電話番号/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: /無料の個別相談を希望する/ }));
    expect(screen.getByRole('textbox', { name: /電話番号/ })).toBeInTheDocument();
  });

  it('checks the phone number and sends the contact step with Enter', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(201, { submissionId: 'sub-1', consultationRequested: true, result: publicResult })
    );
    const user = userEvent.setup();
    render(withIntl(<AxDiagnosisFlow locale="ja" />));
    await answerAs400(user);
    await fillContact(user);
    await user.click(screen.getByRole('checkbox', { name: /無料の個別相談を希望する/ }));
    const phone = screen.getByRole('textbox', { name: /電話番号/ });
    await user.type(phone, '03-1234-5678 内線12{Enter}');
    expect(document.getElementById('contact-phone-error')).toHaveTextContent(
      '電話番号は数字とハイフンで入力してください'
    );
    expect(fetchMock).not.toHaveBeenCalled();

    // Full-width digits typed with a Japanese IME are fine
    await user.clear(phone);
    await user.type(phone, '０３ー１２３４ー５６７８{Enter}');
    expect(await screen.findByRole('heading', { name: '診断結果' })).toBeInTheDocument();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).contact.phone).toBe('０３ー１２３４ー５６７８');
  });

  it('in test mode, asks for a company address on the contact step', { timeout: 30000 }, async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(201, { submissionId: 'sub-1', consultationRequested: false, result: publicResult })
    );
    const user = userEvent.setup();
    render(withIntl(<AxDiagnosisFlow locale="ja" allowedEmailDomains={['sas-com.com']} />));
    await answerAs400(user);
    await fillContact(user);
    const email = screen.getByRole('textbox', { name: /メールアドレス/ });
    await user.clear(email);
    await user.type(email, 'pkuroq@gmail.com{Enter}');

    expect(document.getElementById('contact-email-error')).toHaveTextContent(
      'テスト中のため、@sas-com.com のメールアドレスのみ受け付けています'
    );
    expect(fetchMock).not.toHaveBeenCalled();

    await user.clear(email);
    await user.type(email, 'kurosawa@sas-com.com{Enter}');
    expect(await screen.findByRole('heading', { name: '診断結果' })).toBeInTheDocument();
  });

  it('shows the server refusal of an outside address on the email field', { timeout: 30000 }, async () => {
    // The page was built before test mode was turned on: only the server knows the domains
    fetchMock.mockResolvedValue(
      jsonResponse(400, { code: 'email_domain_not_allowed', domains: ['sas-com.com'] })
    );
    const user = userEvent.setup();
    render(withIntl(<AxDiagnosisFlow locale="ja" />));
    await answerAs400(user);
    await fillContact(user);
    await user.click(screen.getByRole('button', { name: /診断結果を見る/ }));

    const email = screen.getByRole('textbox', { name: /メールアドレス/ });
    expect(await screen.findByText('テスト中のため、@sas-com.com のメールアドレスのみ受け付けています')).toBeInTheDocument();
    expect(email).toHaveFocus();
    expect(email).toHaveAttribute('aria-invalid', 'true');
  });

  it('names the options that clear the others in the multiple-choice note', async () => {
    const user = userEvent.setup();
    render(withIntl(<AxDiagnosisFlow locale="ja" />));
    await user.click(screen.getByTestId('platform-access'));
    await user.click(inGroup(/直せる（変更できる）人/).getByLabelText(/社内の複数人/));
    await user.click(inGroup(/お使いのAccess/).getByLabelText(/Microsoft 365/));
    await next(user);
    expect(
      screen.getByText('複数選択できます（「どれも当てはまらない（入力・検索・印刷が中心）」を選ぶと、ほかの選択は外れます）')
    ).toBeInTheDocument();
  });

  it('walks the steps with the browser history and leaves a finished diagnosis behind', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(201, { submissionId: 'sub-1', consultationRequested: false, result: publicResult })
    );
    const user = userEvent.setup();
    render(withIntl(<AxDiagnosisFlow locale="ja" />));
    await answerAs400(user);
    expect(window.history.state.ax.step).toBe(5);

    window.history.back();
    expect(
      await screen.findByRole('heading', { name: /STEP 5 \/ 6\s*会社の規模（任意）/ })
    ).toBeInTheDocument();
    // The in-page back button walks the same entries
    await user.click(screen.getByRole('button', { name: /戻る/ }));
    expect(await screen.findByRole('heading', { name: /STEP 4 \/ 6/ })).toBeInTheDocument();
    window.history.go(2);
    expect(await screen.findByRole('heading', { name: /最後に、ご連絡先/ })).toBeInTheDocument();

    await fillContact(user);
    await user.click(screen.getByRole('button', { name: /診断結果を見る/ }));
    expect(await screen.findByRole('heading', { name: '診断結果' })).toBeInTheDocument();
    // The step entries are rewound, so the browser's back button leaves the result
    await waitFor(() => expect(window.history.state.ax.step).toBe(0));

    // Another system is a new diagnosis: the finished one's entries no longer show steps
    await user.click(screen.getByRole('button', { name: '別のシステムも診断する' }));
    expect(screen.getByText('STEP 1 / 6')).toBeInTheDocument();
    window.history.forward();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByText('STEP 1 / 6')).toBeInTheDocument();
    expect(screen.getByTestId('platform-as400')).toBeInTheDocument();
  });

  it('submits the answers of the chosen path and shows the result', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(201, { submissionId: 'sub-1', consultationRequested: false, result: publicResult })
    );
    const user = userEvent.setup();
    render(withIntl(<AxDiagnosisFlow locale="ja" entry="ax-lp" />));
    await answerAs400(user);
    await fillContact(user);
    await user.click(screen.getByRole('button', { name: /診断結果を見る/ }));

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/diagnostics/ax-migration');
    const body = JSON.parse(init.body);
    expect(body.answers).toEqual({
      platform: 'as400',
      maintenance: 'few',
      support_end: '1_3y',
      integrations: 'some',
      as400_programs: '500_1999',
      as400_languages: ['rpg4'],
      source_docs: 'source_missing',
      challenges: ['people'],
      timeline: '1_2y',
      industry: 'manufacturing',
      role: 'it_manager',
    });
    // The page the diagnosis was started from (#296)
    expect(body.tracking.entry).toBe('ax-lp');
    expect(body.contact).toEqual({
      company: '三田製作所',
      name: '山田 太郎',
      email: 'yamada@example.jp',
    });
    // No bot check configured, and nothing to continue yet
    expect(body).not.toHaveProperty('turnstileToken');
    expect(body).not.toHaveProperty('continuedFrom');
    expect(screen.queryByTestId('ax-turnstile')).not.toBeInTheDocument();

    expect(await screen.findByRole('heading', { name: '診断結果' })).toHaveFocus();
    expect(screen.getByText('移行元：AS/400（IBM i）')).toBeInTheDocument();
    expect(screen.getByTestId('ax-result-checkpoints')).toHaveTextContent('見つからないソース');
    // Saved answers are removed once the diagnosis is sent
    expect(window.localStorage.getItem('diagnoleads:ax-diagnosis')).toBeNull();
  });
});

describe('AxDiagnosisFlow: another system and the bot check', () => {
  type RenderOptions = {
    callback: (token: string) => void;
    'error-callback': (code?: string) => void;
    'unsupported-callback': () => void;
  };
  const installTurnstile = (onRender: (options: RenderOptions) => void = () => {}) => {
    let count = 0;
    const turnstile = {
      render: vi.fn((_container: HTMLElement, options: RenderOptions) => {
        count += 1;
        onRender(options);
        return `widget-${count}`;
      }),
      remove: vi.fn(),
    };
    window.turnstile = turnstile;
    return turnstile;
  };

  afterEach(() => {
    window.turnstile = undefined;
  });

  it('sends the first submission of the visit with the diagnosis of other systems', async () => {
    for (const id of ['sub-1', 'sub-2', 'sub-3']) {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(200, { submissionId: id, consultationRequested: false, result: publicResult })
      );
    }
    const consentAgain = /ご連絡先は前回の入力を使います/;
    const user = userEvent.setup();
    render(withIntl(<AxDiagnosisFlow locale="ja" />));
    await answerAs400(user);
    expect(screen.queryByText(consentAgain)).not.toBeInTheDocument();
    await fillContact(user);
    await user.click(screen.getByRole('button', { name: /診断結果を見る/ }));

    for (let round = 0; round < 2; round++) {
      await user.click(await screen.findByRole('button', { name: '別のシステムも診断する' }));
      // The contact details are kept; the consent is asked again, and the page says why
      await answerAs400(user);
      expect(screen.getByLabelText(/会社名/)).toHaveValue('三田製作所');
      expect(screen.getByText(consentAgain)).toBeInTheDocument();
      await user.click(screen.getByLabelText('個人情報の取り扱いに同意する'));
      await user.click(screen.getByRole('button', { name: /診断結果を見る/ }));
      await screen.findByRole('heading', { name: '診断結果' });
    }

    const sent = fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body).continuedFrom);
    // Always the first submission (the one that may have created the lead)
    expect(sent).toEqual([undefined, 'sub-1', 'sub-1']);
    // Three whole diagnoses: slower than the default limit on the CI machines
  }, 30_000);

  it('shows the Turnstile check on the contact step and sends its token', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { submissionId: 'sub-1', consultationRequested: false, result: publicResult })
    );
    const turnstile = installTurnstile((options) => options.callback('token-1'));
    const user = userEvent.setup();
    render(withIntl(<AxDiagnosisFlow locale="ja" turnstileSiteKey="site-key" />));
    expect(turnstile.render).not.toHaveBeenCalled();

    await answerAs400(user);
    await waitFor(() => expect(turnstile.render).toHaveBeenCalledTimes(1));
    expect(turnstile.render.mock.calls[0][1]).toMatchObject({
      sitekey: 'site-key',
      action: 'ax-diagnosis',
      language: 'ja',
      theme: 'light',
      // jsdom has no layout: a container narrower than the normal widget gets the compact one
      size: 'compact',
    });
    // Named and explained, so the box is not a mystery
    const group = screen.getByRole('group', { name: '送信前の確認' });
    expect(group).toHaveAccessibleDescription(/機械による自動送信を防ぐための確認です/);
    expect(within(group).getByTestId('ax-turnstile')).toBeInTheDocument();
    await fillContact(user);
    await user.click(screen.getByRole('button', { name: /診断結果を見る/ }));

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).turnstileToken).toBe('token-1');
    await screen.findByRole('heading', { name: '診断結果' });
    // The widget goes with the contact step
    expect(turnstile.remove).toHaveBeenCalledWith('widget-1');
  });

  it('uses the normal widget where it fits', async () => {
    const turnstile = installTurnstile();
    const width = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(520);
    try {
      const user = userEvent.setup();
      render(withIntl(<AxDiagnosisFlow locale="ja" turnstileSiteKey="site-key" />));
      await answerAs400(user);
      await waitFor(() => expect(turnstile.render).toHaveBeenCalled());
      expect(turnstile.render.mock.calls[0][1]).toMatchObject({ size: 'normal' });
    } finally {
      width.mockRestore();
    }
  });

  it('waits for the check before sending, and says when it has finished', async () => {
    const renders: RenderOptions[] = [];
    installTurnstile((options) => renders.push(options));
    const user = userEvent.setup();
    const { container } = render(withIntl(<AxDiagnosisFlow locale="ja" turnstileSiteKey="site-key" />));
    await answerAs400(user);
    await fillContact(user);
    const submit = screen.getByRole('button', { name: /診断結果を見る/ });
    await user.click(submit);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '送信前の確認が終わっていません。確認欄にチェックマーク（✓）が表示されたら、もう一度「診断結果を見る」を押してください。'
    );
    expect(fetchMock).not.toHaveBeenCalled();
    // Pressed again before the check: the message is put out again, so it is read out again
    const first = screen.getByRole('alert');
    await user.click(submit);
    expect(screen.getByRole('alert')).not.toBe(first);

    await act(async () => renders[0].callback('token-1'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(container.querySelector('[aria-live="polite"]')).toHaveTextContent(
      '送信前の確認が完了しました'
    );
  });

  it('asks for a new check after the server refused the token', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(403, { error: 'Verification failed', code: 'verification_failed' })
    );
    const renders: RenderOptions[] = [];
    const turnstile = installTurnstile((options) => {
      renders.push(options);
      // Only the first check passes by itself; the new one is finished by the test
      if (renders.length === 1) options.callback('token-1');
    });
    const user = userEvent.setup();
    render(withIntl(<AxDiagnosisFlow locale="ja" turnstileSiteKey="site-key" />));
    await answerAs400(user);
    await fillContact(user);
    await user.click(screen.getByRole('button', { name: /診断結果を見る/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('送信前の確認をやり直しています');
    await waitFor(() => expect(turnstile.render).toHaveBeenCalledTimes(2));
    expect(turnstile.remove).toHaveBeenCalledWith('widget-1');

    // The new check clears the message, and the next send uses its token
    await act(async () => renders[1].callback('token-2'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /診断結果を見る/ }));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).turnstileToken).toBe('token-2');
  });

  it('says when the checking service could not be reached, until the respondent sends again', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(503, { error: 'Verification unavailable', code: 'verification_unavailable' })
    );
    const renders: RenderOptions[] = [];
    installTurnstile((options) => {
      renders.push(options);
      if (renders.length === 1) options.callback('token-1');
    });
    const user = userEvent.setup();
    render(withIntl(<AxDiagnosisFlow locale="ja" turnstileSiteKey="site-key" />));
    await answerAs400(user);
    await fillContact(user);
    await user.click(screen.getByRole('button', { name: /診断結果を見る/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '確認サービスに一時的につながりませんでした'
    );
    // Not a check the respondent has to redo: the message stays when the new check passes
    await waitFor(() => expect(renders).toHaveLength(2));
    await act(async () => renders[1].callback('token-2'));
    expect(screen.getByRole('alert')).toHaveTextContent('確認サービスに一時的につながりませんでした');
  });

  it('offers to try again when the check cannot be loaded', async () => {
    window.turnstile = undefined;
    const user = userEvent.setup();
    render(withIntl(<AxDiagnosisFlow locale="ja" turnstileSiteKey="site-key" />));
    await answerAs400(user);
    const scripts = () =>
      document.head.querySelectorAll('script[src^="https://challenges.cloudflare.com/"]');
    await waitFor(() => expect(scripts()).toHaveLength(1));
    // Blocked by the network
    await act(async () => scripts()[0].dispatchEvent(new Event('error')));

    expect(screen.getByText('送信前の確認を表示できませんでした。')).toBeInTheDocument();
    // Without a booking page, the phone and email are the way out (#420)
    expect(screen.getByRole('link', { name: '03-5427-3663' })).toHaveAttribute('href', 'tel:+81354273663');
    expect(screen.getByRole('link', { name: 'dx-agency@sas-com.com' })).toHaveAttribute(
      'href',
      'mailto:dx-agency@sas-com.com'
    );
    // The contact details stay: trying again does not reload the page
    expect(screen.getByLabelText(/会社名/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '確認をやり直す' }));
    await waitFor(() => expect(scripts()).toHaveLength(1));
    expect(screen.queryByText('送信前の確認を表示できませんでした。')).not.toBeInTheDocument();
    // Settle the load still under way, so the next test starts a new one
    for (const script of scripts()) script.dispatchEvent(new Event('error'));
  });

  const expectAlternativeContact = (heading = '送信前の確認を表示できませんでした。') => {
    // Read out when it replaces the check
    expect(screen.getByRole('alert')).toHaveTextContent(heading);
    expect(screen.getByRole('link', { name: '03-5427-3663' })).toHaveAttribute('href', 'tel:+81354273663');
    expect(screen.getByRole('link', { name: 'dx-agency@sas-com.com' })).toHaveAttribute(
      'href',
      'mailto:dx-agency@sas-com.com'
    );
    expect(screen.getByRole('button', { name: '確認をやり直す' })).toBeInTheDocument();
  };

  it('offers the phone and email when the script never answers (#537)', async () => {
    window.turnstile = undefined;
    const realSetTimeout = globalThis.setTimeout;
    const timeouts: Array<() => void> = [];
    const spy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
      handler: () => void,
      ms?: number,
      ...rest: unknown[]
    ) => {
      if (ms === LOAD_TIMEOUT_MS) timeouts.push(handler);
      return realSetTimeout(handler, ms, ...rest);
    }) as typeof setTimeout);
    const scripts = () =>
      document.head.querySelectorAll('script[src^="https://challenges.cloudflare.com/"]');
    try {
      const user = userEvent.setup();
      render(withIntl(<AxDiagnosisFlow locale="ja" turnstileSiteKey="site-key" />));
      await answerAs400(user);
      await waitFor(() => expect(scripts()).toHaveLength(1));
      expect(screen.queryByText('送信前の確認を表示できませんでした。')).not.toBeInTheDocument();
      expect(timeouts).toHaveLength(1);

      // Packets dropped by a firewall: neither load nor error ever comes
      const company = screen.getByLabelText(/会社名/);
      company.focus();
      await act(async () => timeouts[0]());
      expectAlternativeContact();
      // Not taken away from what the respondent is typing
      expect(company).toHaveFocus();
      // The hanging script is dropped, so trying again loads it anew
      expect(scripts()).toHaveLength(0);
      await user.click(screen.getByRole('button', { name: '確認をやり直す' }));
      await waitFor(() => expect(scripts()).toHaveLength(1));
    } finally {
      spy.mockRestore();
      for (const script of scripts()) script.dispatchEvent(new Event('error'));
    }
  });

  it('offers the phone and email when the check keeps failing (#537)', async () => {
    const renders: RenderOptions[] = [];
    const turnstile = installTurnstile((options) => renders.push(options));
    const user = userEvent.setup();
    render(withIntl(<AxDiagnosisFlow locale="ja" turnstileSiteKey="site-key" />));
    await answerAs400(user);
    await waitFor(() => expect(renders).toHaveLength(1));

    // One failure: Turnstile tries again by itself, and a pass resets the count
    await act(async () => renders[0]['error-callback']('300010'));
    await act(async () => renders[0].callback('token-1'));
    await act(async () => renders[0]['error-callback']('300010'));
    expect(screen.getByTestId('ax-turnstile')).toBeInTheDocument();
    expect(screen.queryByText('送信前の確認を表示できませんでした。')).not.toBeInTheDocument();

    // Failing again in a row, while the respondent is on the check: it is given up, saying
    // it could not be completed (it was shown), and focus moves to trying again
    const frame = document.createElement('button');
    screen.getByTestId('ax-turnstile').appendChild(frame);
    frame.focus();
    await act(async () => renders[0]['error-callback']('300010'));
    expectAlternativeContact('送信前の確認を完了できませんでした。');
    expect(screen.getByRole('button', { name: '確認をやり直す' })).toHaveFocus();
    expect(turnstile.remove).toHaveBeenCalledWith('widget-1');
    // The token from before the failures is not sent
    await fillContact(user);
    await user.click(screen.getByRole('button', { name: /診断結果を見る/ }));
    expect(fetchMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '確認をやり直す' }));
    await waitFor(() => expect(turnstile.render).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('ax-turnstile')).toBeInTheDocument();
  });

  it('offers the phone and email when the browser is not supported (#537)', async () => {
    const renders: RenderOptions[] = [];
    installTurnstile((options) => renders.push(options));
    const user = userEvent.setup();
    render(withIntl(<AxDiagnosisFlow locale="ja" turnstileSiteKey="site-key" />));
    await answerAs400(user);
    await waitFor(() => expect(renders).toHaveLength(1));
    await act(async () => renders[0]['unsupported-callback']());
    expectAlternativeContact();
  });

  it('says how long to wait when there were too many submissions', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(429, { error: 'Too many requests', code: 'rate_limited' }, { 'Retry-After': '1150' })
      )
      .mockResolvedValueOnce(jsonResponse(429, { error: 'Too many requests' }));
    const user = userEvent.setup();
    render(withIntl(<AxDiagnosisFlow locale="ja" />));
    await answerAs400(user);
    await fillContact(user);
    await user.click(screen.getByRole('button', { name: /診断結果を見る/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '送信が一時的に制限されています。約20分後に、もう一度「診断結果を見る」を押してください。入力内容はこのまま残ります。'
    );
    // Without Retry-After, without a number
    await user.click(screen.getByRole('button', { name: /診断結果を見る/ }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('しばらく時間をおいて、もう一度')
    );
  });
});

describe('AxDiagnosisResult', () => {
  const renderResult = (overrides: Partial<Parameters<typeof AxDiagnosisResult>[0]> = {}) =>
    render(
      withIntl(
        <AxDiagnosisResult
          company="三田製作所"
          platform="as400"
          locale="ja"
          answers={as400Answers}
          submissionId="sub-1"
          result={publicResult}
          consultationRequested={false}
          onDiagnoseAnother={vi.fn()}
          {...overrides}
        />
      )
    );

  const offers = {
    documents: [{ id: 'checklist', title: '機種別チェックリスト', description: '移行前に確かめること' }],
    seminars: [
      { id: 'next', title: '移行の進め方', description: '', date: '2026-11-10', time: '15:00-16:00', format: 'オンライン' },
    ],
  };

  it('does not call a passed deadline close (#288)', () => {
    const high = { ...publicResult, needsHearing: false, urgency: { ...publicResult.urgency, level: 'high' as const } };
    const { unmount } = renderResult({
      result: { ...high, reasons: { ...high.reasons, urgency: ['access_support_ended'] } },
    });
    expect(screen.getByText('切り替えの順番を、一緒に整理しませんか')).toBeInTheDocument();
    expect(screen.queryByText(/期限が迫っています/)).not.toBeInTheDocument();
    unmount();

    renderResult({ result: { ...high, reasons: { ...high.reasons, urgency: ['maintenance_none'] } } });
    expect(screen.getByText('期限までの段取りを、一緒に確認しませんか')).toBeInTheDocument();
  });

  it('describes the agility challenge as the brochure ver01 and the landing page do (#76)', () => {
    renderResult({
      result: { ...publicResult, challenges: { ...publicResult.challenges, primary: 'agility' } },
    });
    expect(screen.getByText(/新商品・新サービスの展開を妨げています/)).toBeInTheDocument();
    expect(screen.getByText(/短いサイクルで機能を追加しやすく、市場の変化に対応しやすい仕組みへ/)).toBeInTheDocument();
    // Not in the brochure: ways of working, the support deadline, use from outside the office
    expect(screen.queryByText(/働き方の変化|社外からの利用/)).not.toBeInTheDocument();
  });

  it('shows no documents or seminars unless the organization offers them (#153)', () => {
    renderResult();
    expect(screen.queryByTestId('ax-info-offers')).not.toBeInTheDocument();
  });

  it('hands out a document once its request is recorded, and signs up for a seminar (#153)', async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { ok: true, url: 'https://files.example.com/a.pdf' }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    renderResult({ offers });
    const panel = within(screen.getByTestId('ax-info-offers'));
    expect(panel.getByText('2026/11/10 ・ 15:00-16:00 ・ オンライン')).toBeInTheDocument();

    await user.click(panel.getByRole('button', { name: '資料を受け取る' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/diagnostics/ax-migration/offers', expect.anything());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      submissionId: 'sub-1',
      kind: 'document',
      offerId: 'checklist',
    });
    expect(await panel.findByRole('link', { name: '資料を開く' })).toHaveAttribute(
      'href',
      'https://files.example.com/a.pdf'
    );

    await user.click(panel.getByRole('button', { name: 'この勉強会に申し込む' }));
    expect(await panel.findByText(/申し込みを受け付けました/)).toBeInTheDocument();
  });

  it('says so when a request fails (#153)', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(jsonResponse(409, { error: 'Unavailable' }));
    renderResult({ offers });
    await user.click(screen.getByRole('button', { name: '資料を受け取る' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('受け付けられませんでした');
  });

  describe('おすすめの進め方（目安） for Access (#303)', () => {
    const accessResult = (answers = {}) =>
      toPublicResult(
        evaluateAxMigration(
          { ...accessAnswers, ...answers },
          undefined,
          new Date('2026-10-21T09:00:00+09:00')
        )
      );
    const renderAccess = (answers = {}, overrides = {}) =>
      renderResult({
        platform: 'access',
        answers: { ...accessAnswers, ...answers },
        result: accessResult(answers),
        ...overrides,
      });

    it('highlights the recommended path with its reasons and shows the other two briefly', () => {
      renderAccess();
      const section = screen.getByTestId('ax-result-access-path');
      expect(section).toHaveAttribute('data-path', 'fix');
      expect(within(section).getByRole('heading', { name: 'おすすめの進め方（目安）' })).toBeInTheDocument();
      const recommended = within(screen.getByTestId('ax-access-path-recommended'));
      expect(recommended.getByText('直して使い続ける')).toBeInTheDocument();
      expect(recommended.getByText(/サポートが終了済み/)).toBeInTheDocument();
      const others = within(screen.getByTestId('ax-access-path-others'));
      expect(others.getAllByRole('listitem')).toHaveLength(2);
      expect(others.getByText('Web に移す')).toBeInTheDocument();
      expect(others.getByText('既製サービスに置き換える')).toBeInTheDocument();
      // A guide, decided together in the consultation; never "the web makes it safe"
      expect(section).toHaveTextContent('ご相談のなかで');
      expect(section).not.toHaveTextContent('安全');
      expect(section).toHaveTextContent('下の追加の質問');
    });

    it('checks what fits the path instead of always suggesting a web system', () => {
      renderAccess();
      const checkpoints = screen.getByTestId('ax-result-checkpoints');
      expect(checkpoints).toHaveTextContent('64bit 版の Office で動くか');
      expect(checkpoints).not.toHaveTextContent('ブラウザから使えるWebシステムにし');
      cleanup();

      renderAccess({ access_challenges: ['audit'] });
      expect(screen.getByTestId('ax-result-access-path')).toHaveAttribute('data-path', 'web');
      expect(screen.getByTestId('ax-result-checkpoints')).toHaveTextContent('ブラウザから使えるWebシステムにし');
    });

    it('names the consultation once on an Access result with many unknowns (#674)', () => {
      const answers = { access_tools: 'unknown', access_screens_forms: 'unknown' };
      renderAccess(answers, { result: { ...accessResult(answers), needsHearing: true } });
      expect(screen.getByTestId('ax-result-unknowns')).toHaveTextContent(
        '30分のオンライン相談で、調べ方からご案内することもできます。'
      );
      expect(screen.getByText(/30分のオンライン相談で現状を伺うと/)).toBeInTheDocument();
      // Across the whole page, not one element at a time
      expect(document.body).not.toHaveTextContent('個別相談');
    });

    it('narrows what to replace, not what to migrate, on the replace path (#674)', () => {
      // Many tools lead to the web path by default; an organization's rules can still replace
      const answers = { access_features: ['none'], access_screens_forms: 'lt20' };
      const replace = accessResult(answers);
      renderAccess(answers, {
        result: { ...replace, checkpoints: ['access_replace_fit', 'access_inventory'] },
      });
      expect(screen.getByTestId('ax-result-access-path')).toHaveAttribute('data-path', 'replace');
      const checkpoints = screen.getByTestId('ax-result-checkpoints');
      expect(checkpoints).toHaveTextContent('置き換えの対象を絞ります');
      expect(checkpoints).not.toHaveTextContent('移行の対象');
      cleanup();

      // The web path still narrows what to migrate
      renderAccess({ access_challenges: ['remote'], access_tools: '21_50' });
      expect(screen.getByTestId('ax-result-access-path')).toHaveAttribute('data-path', 'web');
      expect(screen.getByTestId('ax-result-checkpoints')).toHaveTextContent('移行の対象を絞ります');
    });

    it.each([
      ['fix', {}, 'Microsoft Accessを直して使い続けるときに確認すること'],
      ['web', { access_challenges: ['remote'] }, 'Microsoft AccessからWebシステムへ移行するときに確認すること'],
      [
        'replace',
        { access_features: ['none'], access_screens_forms: 'lt20' },
        'Microsoft Accessから既製サービスに置き換えるときに確認すること',
      ],
    ])('titles the checkpoints after the %s path (#507)', (path, answers, title) => {
      renderAccess(answers);
      expect(screen.getByTestId('ax-result-access-path')).toHaveAttribute('data-path', path);
      expect(
        within(screen.getByTestId('ax-result-checkpoints')).getByRole('heading', { name: title })
      ).toBeInTheDocument();
    });

    it.each([
      ['fix', {}],
      ['web', { access_challenges: ['remote'] }],
      ['replace', { access_features: ['none'], access_screens_forms: 'lt20' }],
    ])('keeps the next step for the %s path', (path, answers) => {
      renderAccess(answers);
      expect(screen.getByTestId('ax-result-access-path')).toHaveAttribute('data-path', path);
      // The consultation of the Access page, by the same name everywhere on the result (#538)
      expect(screen.getAllByRole('button', { name: /30分の無料オンライン相談を申し込む/ })).toHaveLength(2);
      expect(screen.queryByText(/個別相談|移行の進め方/)).not.toBeInTheDocument();
    });

    /** Titles of the next steps, in order */
    const stepTitles = () =>
      within(screen.getByTestId('ax-result-steps'))
        .getAllByRole('listitem')
        .map((item) => item.querySelectorAll('p')[1]?.textContent);

    it('updates the path after the follow-up questions and drops the hint', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(200, { result: accessResult({ access_users: '11_30' }) })
      );
      const user = userEvent.setup();
      renderAccess();
      expect(stepTitles()).toEqual(['棚卸し', '進め方の決定', '直して使い続ける']);
      const followUp = within(screen.getByTestId('ax-follow-up'));
      await user.click(followUp.getByRole('button', { name: /追加質問/ }));
      await user.click(followUp.getByRole('group', { name: /ふだん使っている人/ }).querySelectorAll('label')[2]);
      await user.click(followUp.getByRole('button', { name: '回答して結果を更新する' }));
      await screen.findByText(/結果を更新しました/);
      const section = screen.getByTestId('ax-result-access-path');
      expect(section).toHaveAttribute('data-path', 'web');
      expect(section).toHaveTextContent('11人以上');
      expect(section).not.toHaveTextContent('下の追加の質問');
      // The next steps follow the new path (#457)
      expect(stepTitles()).toEqual(['棚卸し', '進め方の決定', 'Web に移す', 'AX化']);
    });

    it('shows no path for the other systems', () => {
      renderResult();
      expect(screen.queryByTestId('ax-result-access-path')).not.toBeInTheDocument();
    });

    it.each([
      ['fix', {}, ['棚卸し', '進め方の決定', '直して使い続ける']],
      ['web', { access_challenges: ['remote'] }, ['棚卸し', '進め方の決定', 'Web に移す', 'AX化']],
      [
        'replace',
        { access_features: ['none'], access_screens_forms: 'lt20' },
        ['棚卸し', '進め方の決定', '既製サービスに置き換える'],
      ],
    ])('lays out the next steps of the %s path as the Access page does (#457)', (path, answers, titles) => {
      renderAccess(answers);
      expect(screen.getByTestId('ax-result-access-path')).toHaveAttribute('data-path', path);
      const steps = screen.getByTestId('ax-result-steps');
      expect(within(steps).getByRole('heading', { name: 'このあとの流れ' })).toBeInTheDocument();
      expect(steps).toHaveTextContent('次は、30分のオンライン相談で棚卸しを始めます。');
      // Whether checking the files costs anything is said before, never left to guess (#538)
      expect(steps).toHaveTextContent('ファイルを確かめる作業に費用がかかる場合は、前もってお伝えします。');
      expect(stepTitles()).toEqual(titles);
      // Never the migration to a web system of the other paths' steps
      expect(steps).not.toHaveTextContent('最新のWebシステムへ移行します');
      expect(steps).not.toHaveTextContent('簡易診断');
      // Nor the survey of the other paths in the disclaimer
      expect(screen.getByText(/ツールの中身を確かめたうえでお伝えします/)).toBeInTheDocument();
      expect(screen.queryByText(/現行仕様調査で確定します/)).not.toBeInTheDocument();
    });

    it('keeps the steps of the other systems (#457)', () => {
      renderResult();
      const steps = screen.getByTestId('ax-result-steps');
      expect(within(steps).getByRole('heading', { name: '小さく始めて、移行の先のAX化まで' })).toBeInTheDocument();
      expect(stepTitles()).toEqual(['簡易診断', '現行仕様調査', 'マイグレーション', 'AX化']);
      expect(screen.getByText(/現行仕様調査で確定します/)).toBeInTheDocument();
    });

    it('asks for a 30-minute online consultation, without asking the format (#455)', async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, { ok: true, alreadyRequested: false }));
      const user = userEvent.setup();
      renderAccess();
      await user.click(screen.getAllByRole('button', { name: /30分の無料オンライン相談を申し込む/ })[0]);
      expect(await screen.findByText('30分のオンライン相談のお申し込みを受け付けました')).toBeInTheDocument();
      expect(screen.getByText('所要時間の目安：30分程度（オンライン）')).toBeInTheDocument();
      expect(screen.queryByText('所要時間の目安：60分程度')).not.toBeInTheDocument();
      expect(screen.queryByRole('group', { name: 'ご希望の形式' })).not.toBeInTheDocument();
    });
  });

  it('explains the levels and offers a consultation at the top and the bottom', () => {
    renderResult();
    expect(screen.getByTestId('ax-result-reasons')).toHaveTextContent('判定のポイント');
    expect(screen.getAllByRole('button', { name: /無料の個別相談を申し込む/ })).toHaveLength(2);
    expect(screen.getByText(/いまここ/)).toBeInTheDocument();
  });

  it('lists what to check in-house when the respondent did not know', () => {
    renderResult();
    expect(screen.queryByTestId('ax-result-unknowns')).not.toBeInTheDocument();

    cleanup();
    renderResult({ answers: { ...as400Answers, integrations: 'unknown', as400_languages: ['unknown'] } });
    const unknowns = screen.getByTestId('ax-result-unknowns');
    expect(unknowns).toHaveTextContent('社内で確認すると、結果の精度が上がる項目');
    // Only Access names its 30-minute online consultation (#674)
    expect(unknowns).toHaveTextContent('個別相談で、調べ方からご案内することもできます。');
    expect(within(unknowns).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      '他のシステムや取引先とのデータのやり取りは、いくつありますか？',
      'どんな言語・方法で作られていますか？',
    ]);
  });

  it('records a consultation request and confirms it', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true, alreadyRequested: false }));
    const user = userEvent.setup();
    renderResult();
    await user.click(screen.getAllByRole('button', { name: /無料の個別相談を申し込む/ })[0]);

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/diagnostics/ax-migration/consultation',
      expect.objectContaining({ body: JSON.stringify({ submissionId: 'sub-1' }) })
    );
    expect(await screen.findByText('個別相談のお申し込みを受け付けました')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /無料の個別相談を申し込む/ })).not.toBeInTheDocument();
    // The usual consultation outside Access: about an hour, onsite or online (#455)
    expect(screen.getByText('所要時間の目安：60分程度')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'ご希望の形式' })).toBeInTheDocument();
  });

  it('shows a failed consultation request next to the button that was pressed', async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, {}));
    const user = userEvent.setup();
    renderResult();
    const [top] = screen.getAllByRole('button', { name: /無料の個別相談を申し込む/ });
    await user.click(top);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('受け付けできませんでした');
    // Same box as the top button, and the button keeps the focus
    expect(top.closest('div.rounded-2xl')).toContainElement(alert);
    expect(top).toHaveFocus();
  });

  it('tells that the request period has passed when the request is closed (#232)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(409, { error: 'Closed', code: 'closed' }));
    const user = userEvent.setup();
    renderResult();
    await user.click(screen.getAllByRole('button', { name: /無料の個別相談を申し込む/ })[0]);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('受付期間（診断から24時間）を過ぎた');
    expect(alert).not.toHaveTextContent('時間をおいて');
  });

  it('refines the result with the optional follow-up questions', async () => {
    const refined = toPublicResult(
      evaluateAxMigration({ ...as400Answers, source_docs: 'source_missing', gaiji: 'many' })
    );
    fetchMock.mockResolvedValue(jsonResponse(200, { result: refined }));
    const user = userEvent.setup();
    renderResult();

    const followUp = screen.getByTestId('ax-follow-up');
    expect(within(followUp).getByText(/結果の精度を上げる追加質問（任意・7問）/)).toBeInTheDocument();
    await user.click(within(followUp).getByRole('button', { name: /追加質問/ }));
    const submit = within(followUp).getByRole('button', { name: '回答して結果を更新する' });
    // Not sendable before anything is answered (and it keeps the focus while sending)
    expect(submit).toHaveAttribute('aria-disabled', 'true');
    await user.click(submit);
    expect(fetchMock).not.toHaveBeenCalled();

    await user.click(within(followUp).getByRole('group', { name: /外字/ }).querySelector('label') as HTMLElement);
    await user.click(submit);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/diagnostics/ax-migration/details');
    expect(JSON.parse(init.body)).toEqual({ submissionId: 'sub-1', answers: { gaiji: 'none' } });
    const done = await screen.findByText(/結果を更新しました/);
    // The confirmation takes the focus, so it is read out
    expect(done.closest('output')).toHaveFocus();
  });

  it('prints the result (or saves it as a PDF) with the browser, from the top or the end', async () => {
    const print = vi.fn();
    vi.stubGlobal('print', print);
    const user = userEvent.setup();
    const { container } = renderResult();
    // The print styles keep only this element
    expect(container.querySelector('[data-ax-result]')).toBeInTheDocument();
    // A date line for the printout (hidden on the screen)
    expect(screen.getByText(/^診断日：\d{4}年\d{1,2}月\d{1,2}日$/)).toBeInTheDocument();

    const buttons = screen.getAllByRole('button', { name: '印刷・PDFで保存' });
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toHaveAccessibleDescription(/「PDFに保存」にすると/);
    await user.click(buttons[1]);
    expect(print).toHaveBeenCalledTimes(1);
  });

  it('puts the answers, the provider and the page on the printout', () => {
    renderResult();
    const answers = screen.getByTestId('ax-result-answers');
    expect(within(answers).getByText('回答の内容')).toBeInTheDocument();
    expect(within(answers).getByText('業種は？')).toBeInTheDocument();
    expect(within(answers).getByText('製造業')).toBeInTheDocument();
    // Multiple choices are listed together
    expect(within(answers).getByText(/扱える人が減って.*、/)).toBeInTheDocument();
    expect(screen.getByText('提供：エス・エー・エス株式会社 DXサービス部')).toBeInTheDocument();
    expect(screen.getByText(`診断のページ：${window.location.origin}${window.location.pathname}`)).toBeInTheDocument();
    // What the document is, instead of the English eyebrow
    expect(screen.getByText('AXマイグレーション 無料Web診断')).toBeInTheDocument();
  });

  it('names the saved PDF after the result while printing', () => {
    document.title = 'AXマイグレーション 無料Web診断';
    renderResult();
    window.dispatchEvent(new Event('beforeprint'));
    expect(document.title).toMatch(/^AXマイグレーション無料Web診断結果_AS\/400（IBM i）_\d{4}-\d{2}-\d{2}$/);
    window.dispatchEvent(new Event('afterprint'));
    expect(document.title).toBe('AXマイグレーション 無料Web診断');
  });

  it('lets the respondent check another system', async () => {
    const onDiagnoseAnother = vi.fn();
    const user = userEvent.setup();
    renderResult({ onDiagnoseAnother });
    await user.click(screen.getByRole('button', { name: '別のシステムも診断する' }));
    expect(onDiagnoseAnother).toHaveBeenCalled();
  });
});

describe('Result by email (#154)', () => {
  const submitted = jsonResponse(201, {
    submissionId: 'sub-1',
    consultationRequested: false,
    result: publicResult,
  });

  async function finish(user: User) {
    await answerAs400(user);
    await fillContact(user);
    await user.click(screen.getByRole('button', { name: /診断結果を見る/ }));
    await screen.findByRole('heading', { name: '診断結果' });
  }

  it('is hidden unless the flag is on', async () => {
    fetchMock.mockResolvedValue(submitted);
    const user = userEvent.setup();
    render(withIntl(<AxDiagnosisFlow locale="ja" />));
    await finish(user);
    expect(screen.queryByTestId('ax-result-email')).not.toBeInTheDocument();
  });

  it('shows the typed address, the consent with its version, and posts only the submission', async () => {
    fetchMock.mockResolvedValueOnce(submitted);
    const user = userEvent.setup();
    render(
      withIntl(
        <AxDiagnosisFlow
          locale="ja"
          resultEmailEnabled
          privacyPolicyUrl="https://example.co.jp/privacy"
        />
      )
    );
    await finish(user);

    const block = screen.getByTestId('ax-result-email');
    expect(within(block).getByText('送信先：yamada@example.jp')).toBeInTheDocument();
    expect(within(block).getByText(messages.axDiagnosis.resultEmail.consent.body)).toBeInTheDocument();
    expect(within(block).getByText('同意文 2026-10-22 版')).toBeInTheDocument();
    expect(within(block).getByRole('link', { name: '個人情報保護方針' })).toHaveAttribute(
      'href',
      'https://example.co.jp/privacy'
    );

    fetchMock.mockResolvedValueOnce(jsonResponse(200, { status: 'accepted' }));
    await user.click(within(block).getByRole('button', { name: '同意して確認のメールを受け取る' }));
    expect(await within(block).findByText('お申し込みを受け付けました')).toBeInTheDocument();
    expect(within(block).getByText(/72時間/)).toBeInTheDocument();
    const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
    expect(url).toBe('/api/diagnostics/ax-migration/result-email');
    // The address is decided on the server: the request carries none
    expect(JSON.parse(init.body as string)).toEqual({ submissionId: 'sub-1', locale: 'ja' });
  });

  const renderResult = () =>
    render(
      withIntl(
        <AxDiagnosisResult
          company="三田製作所"
          platform="as400"
          locale="ja"
          answers={as400Answers}
          submissionId="sub-1"
          result={publicResult}
          consultationRequested={false}
          resultEmail={{ email: 'yamada@example.jp' }}
          onDiagnoseAnother={vi.fn()}
        />
      )
    );

  it('shows the same text for a second request as for the first (the API answers accepted for both)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { status: 'accepted' }));
    const user = userEvent.setup();
    renderResult();
    await user.click(screen.getByRole('button', { name: '同意して確認のメールを受け取る' }));
    expect(await screen.findByText('お申し込みを受け付けました')).toBeInTheDocument();
    expect(screen.getByText(/確認のメールをお送りします。/)).toBeInTheDocument();
    expect(screen.queryByText(/すでにお申し込み/)).not.toBeInTheDocument();
  });

  it.each([
    // An answer the API no longer gives is not taken as accepted
    [jsonResponse(200, { status: 'already_requested' }), messages.axDiagnosis.result.email.failed],
    [jsonResponse(409, { status: 'closed' }), messages.axDiagnosis.result.email.closed],
    [jsonResponse(503, { status: 'unavailable' }), messages.axDiagnosis.result.email.unavailable],
    [jsonResponse(500, {}), messages.axDiagnosis.result.email.failed],
  ])('explains each answer (%#)', async (response, text) => {
    fetchMock.mockResolvedValueOnce(response);
    const user = userEvent.setup();
    renderResult();
    await user.click(screen.getByRole('button', { name: '同意して確認のメールを受け取る' }));
    expect(await screen.findByText(text)).toBeInTheDocument();
  });

  it('leaves the privacy link out without a policy URL and is not printed', () => {
    renderResult();
    const block = screen.getByTestId('ax-result-email');
    expect(within(block).queryByRole('link')).not.toBeInTheDocument();
    expect(block).toHaveClass('print:hidden');
  });
});

describe('Column for the Access result (#363)', () => {
  type AnalyticsWindow = Window & { dataLayer?: unknown[]; gtag?: unknown };
  const crossLinkEvents = () =>
    ((window as AnalyticsWindow).dataLayer ?? []).filter(
      (entry) => (entry as { event?: unknown }).event === 'ax_cross_link_click'
    );
  /** jsdom does not navigate; the address a click opens is the link's href after the click */
  const stopNavigation = (event: MouseEvent) => event.preventDefault();

  beforeEach(() => {
    (window as AnalyticsWindow).gtag = undefined;
    (window as AnalyticsWindow).dataLayer = [];
    document.addEventListener('click', stopNavigation);
  });

  afterEach(() => {
    document.removeEventListener('click', stopNavigation);
    (window as AnalyticsWindow).dataLayer = undefined;
  });

  const accessResult = toPublicResult(evaluateAxMigration(accessAnswers));
  const renderResult = (overrides: Partial<Parameters<typeof AxDiagnosisResult>[0]> = {}) =>
    render(
      withIntl(
        <AxDiagnosisResult
          company="三田製作所"
          platform="access"
          locale="ja"
          answers={accessAnswers}
          submissionId="sub-1"
          result={accessResult}
          consultationRequested={false}
          onDiagnoseAnother={vi.fn()}
          {...overrides}
        />
      )
    );

  it('shows exactly one article under the consultation block, without a filled button', () => {
    // Access 2016 / 2019 is out of support
    renderResult();
    const block = screen.getByTestId('ax-result-column');
    expect(block).toHaveAttribute('data-column', 'access-office-support-end');
    expect(block).toHaveClass('print:hidden');
    expect(
      within(block).getByRole('heading', { name: '回答に合わせて、次に読みたいコラム' })
    ).toBeInTheDocument();
    const links = within(block).getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', '/ja/ax-migration/column/access-office-support-end');
    // A new tab: going back in the same tab could lose the result, which lives only in memory
    expect(links[0]).toHaveAttribute('target', '_blank');
    expect(links[0]).toHaveAttribute('rel', 'noopener');
    expect(links[0]).toHaveAccessibleName(/（新しいタブで開きます）$/);
    expect(block).toHaveTextContent('この結果はこのページに残ります');
    expect(links[0]).toHaveTextContent(
      'Access 2016・2019・2021 のサポート終了：使い続けるとどうなり、何をすればよいか'
    );
    expect(block).toHaveTextContent('Access 2016・2019は2025年10月');
    expect(within(block).queryByRole('button')).not.toBeInTheDocument();
    // Decorative thumbnail
    expect(block.querySelector('img')).toHaveAttribute('alt', '');
    // Right after the consultation block
    expect(screen.getByTestId('ax-result-cta').nextElementSibling).toBe(block);
  });

  it('follows the answers', () => {
    renderResult({
      answers: { ...accessAnswers, access_version: ['m365'], access_sources: 'compiled' },
    });
    expect(screen.getByTestId('ax-result-column')).toHaveAttribute(
      'data-column',
      'access-accde-only'
    );
    expect(screen.getByRole('link', { name: /\.accde（\.mde）しか残っていない/ })).toHaveAttribute(
      'href',
      '/ja/ax-migration/column/access-accde-only'
    );
  });

  it('changes the article when the follow-up answers point to another one', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { result: accessResult }));
    const user = userEvent.setup();
    renderResult({ answers: { ...accessAnswers, access_version: ['m365'] } });
    expect(screen.getByTestId('ax-result-column')).toHaveAttribute(
      'data-column',
      'access-fix-or-web'
    );
    const followUp = within(screen.getByTestId('ax-follow-up'));
    await user.click(followUp.getByRole('button', { name: /追加質問/ }));
    await user.click(
      within(followUp.getByRole('group', { name: /データが入ったファイルの容量/ })).getByLabelText(
        /1GB以上/
      )
    );
    await user.click(followUp.getByRole('button', { name: '回答して結果を更新する' }));
    await screen.findByText(/結果を更新しました/);
    expect(screen.getByTestId('ax-result-column')).toHaveAttribute(
      'data-column',
      'access-2gb-limit'
    );
  });

  it('carries from, the utm_*, ref and agency, and sends ax_cross_link_click with the article', async () => {
    window.history.replaceState(null, '', '/ja/ax-diagnosis?utm_source=google&ref=partner-a&agency=ag-1');
    const user = userEvent.setup();
    renderResult();
    const link = within(screen.getByTestId('ax-result-column')).getByRole('link');
    await user.click(link);
    expect(link).toHaveAttribute(
      'href',
      '/ja/ax-migration/column/access-office-support-end?utm_source=google&ref=partner-a&agency=ag-1&from=ax-diagnosis-result'
    );
    expect(crossLinkEvents()).toEqual([
      {
        event: 'ax_cross_link_click',
        from_page: 'ax-diagnosis',
        to_page: 'ax-column',
        location: 'result',
        column_slug: 'access-office-support-end',
      },
    ]);
  });

  it('names the landing page the diagnosis is embedded in, like entry', async () => {
    window.history.replaceState(null, '', '/ja/ax-migration/access');
    const user = userEvent.setup();
    renderResult({ embedded: true });
    const link = within(screen.getByTestId('ax-result-column')).getByRole('link');
    await user.click(link);
    expect(link.getAttribute('href')).toBe(
      '/ja/ax-migration/column/access-office-support-end?from=ax-access-lp-result'
    );
    expect(crossLinkEvents()[0]).toMatchObject({ from_page: 'ax-access-lp', location: 'result' });
  });

  it('shows no article for the other systems or a locale without articles', () => {
    const { unmount } = renderResult({
      platform: 'as400',
      answers: as400Answers,
      result: publicResult,
    });
    expect(screen.queryByTestId('ax-result-column')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Access/ })).not.toBeInTheDocument();
    unmount();
    renderResult({ locale: 'en' });
    expect(screen.queryByTestId('ax-result-column')).not.toBeInTheDocument();
  });
});
