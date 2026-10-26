/**
 * The form of a diagnosis made in the builder (/d/[slug]): the contact step names a field over
 * the limits of the API under it before sending, as the AX diagnosis does (#714).
 * The questions are the made-up cloud readiness quiz of the fixtures.
 */
import { DiagnosisFlow } from '@/components/features/public-diagnosis/diagnosis-flow';
import { toPublicDefinition } from '@/lib/features/diagnosis-builder/evaluate';
import messages from '@/locales/ja/common.json';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cloudReadiness } from '../../../fixtures/diagnosis-builder';

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  window.localStorage.clear();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
  // The check is never passed here: the contact fields are checked before it is needed
  window.turnstile = { render: vi.fn(() => 'widget-1'), remove: vi.fn() };
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.turnstile = undefined;
  window.history.replaceState(null, '', '/');
});

type User = ReturnType<typeof userEvent.setup>;

const renderFlow = () =>
  render(
    <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
      <DiagnosisFlow
        slug="cloud-readiness"
        versionId="0b6f4c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e"
        version={1}
        definition={toPublicDefinition(cloudReadiness())}
        locale="ja"
        turnstileSiteKey="site-key"
      />
    </NextIntlClientProvider>
  );

const next = (user: User) => user.click(screen.getByRole('button', { name: '次へ' }));

/** Through the questions of the quiz (the cloud path) to the contact step */
async function answerQuestions(user: User) {
  await user.click(screen.getByRole('radio', { name: 'クラウド' }));
  await user.type(screen.getByRole('textbox', { name: /担当者の人数/ }), '10');
  await next(user);
  await user.click(screen.getByRole('checkbox', { name: '監視' }));
  await next(user);
  await user.click(screen.getByRole('radio', { name: /3/ }));
  await next(user);
}

describe('DiagnosisFlow: contact step', () => {
  it('names the contact fields over the limits of the API under them, before sending (#714)', async () => {
    const user = userEvent.setup();
    renderFlow();
    await answerQuestions(user);
    const replace = async (name: RegExp, value: string) => {
      const field = screen.getByRole('textbox', { name });
      await user.clear(field);
      await user.click(field);
      await user.paste(value);
    };
    await replace(/会社名/, 'あ'.repeat(201));
    await replace(/お名前/, 'あ'.repeat(101));
    await replace(/会社のメールアドレス/, `${'a'.repeat(244)}@example.jp`);
    await user.click(screen.getByLabelText('個人情報の取り扱いに同意する'));
    await user.click(screen.getByRole('checkbox', { name: /無料の個別相談を希望する/ }));
    await replace(/電話番号/, '0'.repeat(31));
    await user.click(screen.getByRole('button', { name: '診断結果を見る' }));

    expect(document.getElementById('contact-company-error')).toHaveTextContent(
      '会社名は200文字以内で入力してください'
    );
    expect(document.getElementById('contact-name-error')).toHaveTextContent(
      'お名前は100文字以内で入力してください'
    );
    expect(document.getElementById('contact-email-error')).toHaveTextContent(
      '会社のメールアドレスは254文字以内で入力してください'
    );
    expect(document.getElementById('contact-phone-error')).toHaveTextContent(
      '電話番号は30文字以内で入力してください'
    );
    expect(screen.getByRole('textbox', { name: /会社名/ })).toHaveFocus();
    expect(fetchMock).not.toHaveBeenCalled();

    // Within the limits but the email, the focus goes to the email
    await replace(/会社名/, 'あ'.repeat(200));
    await replace(/お名前/, 'あ'.repeat(100));
    await replace(/電話番号/, '0'.repeat(30));
    await user.click(screen.getByRole('button', { name: '診断結果を見る' }));
    expect(document.getElementById('contact-company-error')).not.toBeInTheDocument();
    expect(document.getElementById('contact-phone-error')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /会社のメールアドレス/ })).toHaveFocus();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
