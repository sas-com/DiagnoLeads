/**
 * AX migration diagnosis v2 components (real next-intl messages, fetch mocked)
 */
import { AxDiagnosisFlow } from '@/components/features/ax-diagnosis/ax-diagnosis-flow';
import { AxDiagnosisResult } from '@/components/features/ax-diagnosis/ax-diagnosis-result';
import { axMigrationDefinition } from '@/lib/features/diagnostics/ax-migration/definition';
import { evaluateAxMigration, toPublicResult } from '@/lib/features/diagnostics/ax-migration/evaluate';
import messages from '@/locales/ja/common.json';
import { as400Answers } from '@/test/fixtures/ax-migration';
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
    expect(screen.getByText('STEP 1 / 5')).toBeInTheDocument();
    for (const id of ['as400', 'acos', 'access', 'other']) {
      expect(screen.getByTestId(`platform-${id}`)).toBeInTheDocument();
    }

    await user.click(screen.getByTestId('platform-acos'));
    const heading = screen.getByRole('heading', { name: /STEP 2 \/ 5\s*機種と運用/ });
    expect(heading).toHaveFocus();
    expect(fetchMock).not.toHaveBeenCalled();
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
    expect(screen.getByRole('heading', { name: /STEP 2 \/ 5/ })).toBeInTheDocument();
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
    expect(screen.getByRole('heading', { name: /STEP 3 \/ 5\s*規模と作り/ })).toBeInTheDocument();
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
    expect(window.history.state.ax.step).toBe(4);

    window.history.back();
    expect(await screen.findByRole('heading', { name: /STEP 4 \/ 5/ })).toBeInTheDocument();
    // The in-page back button walks the same entries
    await user.click(screen.getByRole('button', { name: /戻る/ }));
    expect(await screen.findByRole('heading', { name: /STEP 3 \/ 5/ })).toBeInTheDocument();
    window.history.go(2);
    expect(await screen.findByRole('heading', { name: /最後に、ご連絡先/ })).toBeInTheDocument();

    await fillContact(user);
    await user.click(screen.getByRole('button', { name: /診断結果を見る/ }));
    expect(await screen.findByRole('heading', { name: '診断結果' })).toBeInTheDocument();
    // The step entries are rewound, so the browser's back button leaves the result
    await waitFor(() => expect(window.history.state.ax.step).toBe(0));

    // Another system is a new diagnosis: the finished one's entries no longer show steps
    await user.click(screen.getByRole('button', { name: '別のシステムも診断する' }));
    expect(screen.getByText('STEP 1 / 5')).toBeInTheDocument();
    window.history.forward();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByText('STEP 1 / 5')).toBeInTheDocument();
    expect(screen.getByTestId('platform-as400')).toBeInTheDocument();
  });

  it('submits the answers of the chosen path and shows the result', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(201, { submissionId: 'sub-1', consultationRequested: false, result: publicResult })
    );
    const user = userEvent.setup();
    render(withIntl(<AxDiagnosisFlow locale="ja" />));
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
  type RenderOptions = { callback: (token: string) => void };
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
  });

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
    // The contact details stay: trying again does not reload the page
    expect(screen.getByLabelText(/会社名/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '確認をやり直す' }));
    await waitFor(() => expect(scripts()).toHaveLength(1));
    expect(screen.queryByText('送信前の確認を表示できませんでした。')).not.toBeInTheDocument();
    for (const script of scripts()) script.remove();
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
    expect(screen.getByText('AXマイグレーション 移行診断')).toBeInTheDocument();
  });

  it('names the saved PDF after the result while printing', () => {
    document.title = 'AXマイグレーション 移行診断';
    renderResult();
    window.dispatchEvent(new Event('beforeprint'));
    expect(document.title).toMatch(/^AX移行診断結果_AS\/400（IBM i）_\d{4}-\d{2}-\d{2}$/);
    window.dispatchEvent(new Event('afterprint'));
    expect(document.title).toBe('AXマイグレーション 移行診断');
  });

  it('lets the respondent check another system', async () => {
    const onDiagnoseAnother = vi.fn();
    const user = userEvent.setup();
    renderResult({ onDiagnoseAnother });
    await user.click(screen.getByRole('button', { name: '別のシステムも診断する' }));
    expect(onDiagnoseAnother).toHaveBeenCalled();
  });
});
