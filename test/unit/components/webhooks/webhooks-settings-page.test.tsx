/**
 * Webhook settings page (real ja messages, tRPC mocked) — #314, #321
 *
 * A user without the right to view webhooks sees 「権限がありません」 instead of the empty state;
 * the create, edit, pause and delete buttons appear only for those allowed to use them; stored
 * header values are never on the page, and the edit form keeps or replaces each one. A refused
 * destination is flagged for managers, and a refused test send or URL gets a message (#321).
 */
import WebhooksSettingsPage from '@/app/[locale]/(dashboard)/settings/webhooks/page';
import { WEBHOOK_HEADER_MASK } from '@/lib/features/webhooks/services/webhook-headers';
import messages from '@/locales/ja/common.json';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const WEBHOOK_ID = '880e8400-e29b-41d4-a716-446655440000';

type Permissions = { canCreate: boolean; canUpdate: boolean; canDelete: boolean };
type ListResult = {
  data?: {
    webhooks: unknown[];
    total: number;
    limit: number;
    offset: number;
    permissions: Permissions;
  };
  isLoading: boolean;
  error: { data: { code: string } } | null;
};

type MutationError = { message: string; data?: { code?: string } };
const mocks = vi.hoisted(() => ({
  list: undefined as unknown as ListResult,
  update: vi.fn(),
  create: vi.fn(),
  remove: vi.fn(),
  toastError: vi.fn(),
  /** When set, update calls fail with this error */
  updateError: null as null | { message: string; data?: { code?: string } },
  /** When set, create calls fail with this error */
  createError: null as null | { message: string; data?: { code?: string } },
  test: vi.fn(),
  /** When set, test sends fail with this error; otherwise they report `testSuccess` */
  testError: null as null | { message: string; data?: { code?: string } },
  testSuccess: true,
  toastSuccess: vi.fn(),
}));

vi.mock('@/hooks/use-organization', () => ({
  useOrganization: () => ({ organization: { id: ORG_ID }, isLoading: false }),
}));
vi.mock('sonner', () => ({ toast: { success: mocks.toastSuccess, error: mocks.toastError } }));
vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    useUtils: () => ({ webhooks: { list: { invalidate: vi.fn() } } }),
    webhooks: {
      list: { useQuery: () => mocks.list },
      create: {
        useMutation: (options: { onError?: (error: MutationError) => void }) => ({
          mutate: (input: unknown) => {
            mocks.create(input);
            if (mocks.createError) options.onError?.(mocks.createError);
          },
          isPending: false,
        }),
      },
      test: {
        useMutation: (options: {
          onSuccess?: (result: { success: boolean }) => void;
          onError?: (error: MutationError) => void;
          onSettled?: () => void;
        }) => ({
          mutate: (input: unknown) => {
            mocks.test(input);
            if (mocks.testError) options.onError?.(mocks.testError);
            else options.onSuccess?.({ success: mocks.testSuccess });
            options.onSettled?.();
          },
          isPending: false,
        }),
      },
      update: {
        useMutation: (options: { onError?: (error: MutationError) => void }) => ({
          mutate: (input: unknown) => {
            mocks.update(input);
            if (mocks.updateError) options.onError?.(mocks.updateError);
          },
          isPending: false,
        }),
      },
      delete: { useMutation: () => ({ mutate: mocks.remove, isPending: false }) },
    },
  },
}));

const webhook = {
  id: WEBHOOK_ID,
  organizationId: ORG_ID,
  name: 'CRM連携',
  url: 'https://hooks.example.com/crm',
  secret: 'whsec_ab••••••••wxyz',
  events: ['lead.created'],
  status: 'active',
  headers: [
    { name: 'Authorization', masked: true },
    { name: 'X-Tenant', masked: true },
  ],
  retryConfig: { maxRetries: 3, retryDelayMs: 5000 },
  urlRefusal: null as string | null,
  lastTriggeredAt: null,
  failureCount: 0,
  createdAt: '2026-10-22T00:00:00Z',
  updatedAt: '2026-10-22T00:00:00Z',
};

const listed = (permissions: Permissions, webhooks: unknown[] = [webhook]): ListResult => ({
  data: { webhooks, total: webhooks.length, limit: 20, offset: 0, permissions },
  isLoading: false,
  error: null,
});

const NONE = { canCreate: false, canUpdate: false, canDelete: false };
const ALL = { canCreate: true, canUpdate: true, canDelete: true };

const renderPage = () =>
  render(
    <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
      <WebhooksSettingsPage />
    </NextIntlClientProvider>
  );

beforeEach(() => {
  vi.clearAllMocks();
  mocks.updateError = null;
  mocks.createError = null;
  mocks.testError = null;
  mocks.testSuccess = true;
});

describe('WebhooksSettingsPage', () => {
  it('shows 「権限がありません」 when viewing is refused', () => {
    mocks.list = { data: undefined, isLoading: false, error: { data: { code: 'FORBIDDEN' } } };
    renderPage();

    expect(screen.getByText('権限がありません')).toBeInTheDocument();
    expect(screen.queryByText('Webhookが設定されていません')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Webhookを作成' })).not.toBeInTheDocument();
  });

  it('hides the create, edit, pause and delete buttons without permission', () => {
    mocks.list = listed(NONE);
    renderPage();

    expect(screen.getByText('CRM連携')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Webhookを作成' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '編集' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '一時停止' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '削除' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'テスト送信' })).not.toBeInTheDocument();
  });

  it('hides the first-webhook button without permission to create', () => {
    mocks.list = listed(NONE, []);
    renderPage();

    expect(screen.getByText('Webhookが設定されていません')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '最初のWebhookを作成' })).not.toBeInTheDocument();
  });

  it('shows the buttons to a user who may use them', () => {
    mocks.list = listed(ALL);
    renderPage();

    expect(screen.getByRole('button', { name: 'Webhookを作成' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '編集' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '一時停止' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '削除' })).toBeInTheDocument();
  });

  it('lists header names with a mask', () => {
    mocks.list = listed(NONE);
    renderPage();

    expect(screen.getByText(`Authorization: ${WEBHOOK_HEADER_MASK}`)).toBeInTheDocument();
    expect(screen.getByText(`X-Tenant: ${WEBHOOK_HEADER_MASK}`)).toBeInTheDocument();
  });

  it('edits headers: a masked value is kept, a re-entered one is sent, a removed one is left out', async () => {
    mocks.list = listed(ALL);
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: '編集' }));
    const dialog = await screen.findByRole('dialog');

    const authorization = within(dialog).getByLabelText('Authorization の値');
    expect(authorization).toHaveValue(WEBHOOK_HEADER_MASK);
    expect(authorization).toHaveAttribute('readonly');

    // Replace the Authorization value
    const [replaceAuthorization] = within(dialog).getAllByRole('button', { name: '値を入れ直す' });
    await userEvent.click(replaceAuthorization);
    const newValue = within(dialog).getByLabelText('Authorization の値');
    expect(newValue).toHaveValue('');
    await userEvent.type(newValue, 'Bearer made-up-new');

    // Add a header, then remove X-Tenant
    await userEvent.click(within(dialog).getByRole('button', { name: 'ヘッダーを追加' }));
    const names = within(dialog).getAllByLabelText('ヘッダー名');
    await userEvent.type(names[names.length - 1], 'X-Trace');
    await userEvent.type(within(dialog).getByLabelText('X-Trace の値'), 'trace-made-up');
    await userEvent.click(within(dialog).getByRole('button', { name: 'X-Tenant を削除' }));

    await userEvent.click(within(dialog).getByRole('button', { name: '保存' }));

    expect(mocks.update).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      id: WEBHOOK_ID,
      name: 'CRM連携',
      url: 'https://hooks.example.com/crm',
      events: ['lead.created'],
      headers: [
        { name: 'Authorization', value: 'Bearer made-up-new' },
        { name: 'X-Trace', value: 'trace-made-up' },
      ],
    });
  });

  it('saving without touching the headers sends the names only', async () => {
    mocks.list = listed(ALL);
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: '編集' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: '保存' }));

    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: [{ name: 'Authorization' }, { name: 'X-Tenant' }],
      })
    );
  });

  it('asks for every header value again when the URL changes at all (S1)', async () => {
    mocks.list = listed(ALL);
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: '編集' }));
    const dialog = await screen.findByRole('dialog');
    const save = within(dialog).getByRole('button', { name: '保存' });

    // The same URL typed again (normalised): the stored values may be kept
    const url = within(dialog).getByLabelText('エンドポイントURL');
    await userEvent.clear(url);
    await userEvent.type(url, 'https://HOOKS.example.com:443/crm');
    expect(within(dialog).queryByText(/保存済みのヘッダーの値は使えません/)).not.toBeInTheDocument();
    expect(save).toBeEnabled();

    // Another path of the same receiver: blocked
    await userEvent.clear(url);
    await userEvent.type(url, 'https://hooks.example.com/other-path');
    expect(within(dialog).getByText(/保存済みのヘッダーの値は使えません/)).toBeInTheDocument();
    expect(save).toBeDisabled();

    // Another host: saving is blocked until every value is entered again
    await userEvent.clear(url);
    await userEvent.type(url, 'https://elsewhere.example.net/hook');
    expect(within(dialog).getByText(/保存済みのヘッダーの値は使えません/)).toBeInTheDocument();
    expect(save).toBeDisabled();

    await userEvent.click(within(dialog).getByRole('button', { name: 'すべての値を入れ直す' }));
    expect(within(dialog).getByLabelText('Authorization の値')).toHaveValue('');
    expect(within(dialog).getByLabelText('X-Tenant の値')).toHaveValue('');
    expect(within(dialog).queryByText(/保存済みのヘッダーの値は使えません/)).not.toBeInTheDocument();
    expect(save).toBeDisabled();

    await userEvent.type(within(dialog).getByLabelText('Authorization の値'), 'Bearer made-up-a');
    await userEvent.type(within(dialog).getByLabelText('X-Tenant の値'), 'tenant-made-up');
    expect(save).toBeEnabled();
    await userEvent.click(save);

    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://elsewhere.example.net/hook',
        headers: [
          { name: 'Authorization', value: 'Bearer made-up-a' },
          { name: 'X-Tenant', value: 'tenant-made-up' },
        ],
      })
    );
  });

  it('flags a reserved or malformed name and a duplicate, and blocks saving', async () => {
    mocks.list = listed(ALL);
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: '編集' }));
    const dialog = await screen.findByRole('dialog');
    const save = within(dialog).getByRole('button', { name: '保存' });

    await userEvent.click(within(dialog).getByRole('button', { name: 'ヘッダーを追加' }));
    const names = within(dialog).getAllByLabelText('ヘッダー名');
    const added = names[names.length - 1];

    await userEvent.type(added, 'X-Webhook-Signature');
    expect(within(dialog).getByText(/このヘッダー名は使えません/)).toBeInTheDocument();
    expect(save).toBeDisabled();

    await userEvent.clear(added);
    await userEvent.type(added, 'x-tenant');
    expect(within(dialog).queryByText(/このヘッダー名は使えません/)).not.toBeInTheDocument();
    expect(within(dialog).getByText(/同じヘッダー名が複数あります/)).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText('x-tenant の値'), 'v');
    expect(save).toBeDisabled();
  });

  it('creates a webhook with its headers as a list, names trimmed', async () => {
    mocks.list = listed(ALL, []);
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: 'Webhookを作成' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Webhook名'), 'CRM');
    await userEvent.type(within(dialog).getByLabelText('エンドポイントURL'), 'https://hooks.example.com/new');
    await userEvent.click(within(dialog).getByText('Lead Created'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'ヘッダーを追加' }));
    await userEvent.type(within(dialog).getByLabelText('ヘッダー名'), ' Authorization ');
    await userEvent.type(within(dialog).getByLabelText(/の値$/), 'Bearer made-up-new');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Webhookを作成' }));

    expect(mocks.create).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      name: 'CRM',
      url: 'https://hooks.example.com/new',
      events: ['lead.created'],
      headers: [{ name: 'Authorization', value: 'Bearer made-up-new' }],
    });
  });

  it('explains a CONFLICT instead of showing the server message', async () => {
    mocks.list = listed(ALL);
    mocks.updateError = { message: 'conflict: the webhook was changed meanwhile', data: { code: 'CONFLICT' } };
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: '編集' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: '保存' }));

    expect(mocks.toastError).toHaveBeenCalledWith(
      'ほかの変更と重なりました。画面を読み込み直してから、もう一度保存してください。'
    );
  });

  it('flags a value that is not printable ASCII and blocks saving', async () => {
    mocks.list = listed(ALL);
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: '編集' }));
    const dialog = await screen.findByRole('dialog');
    const save = within(dialog).getByRole('button', { name: '保存' });

    const [replaceAuthorization] = within(dialog).getAllByRole('button', { name: '値を入れ直す' });
    await userEvent.click(replaceAuthorization);
    const value = within(dialog).getByLabelText('Authorization の値');
    await userEvent.type(value, 'トークン');
    expect(within(dialog).getByText(/値に使えるのは半角の英数字・記号・空白だけです/)).toBeInTheDocument();
    expect(save).toBeDisabled();

    await userEvent.clear(value);
    await userEvent.type(value, 'Bearer made-up-ascii');
    expect(within(dialog).queryByText(/値に使えるのは半角/)).not.toBeInTheDocument();
    expect(save).toBeEnabled();
  });
  describe('destination guard and test sends (#321)', () => {
    it('flags a webhook whose destination is refused, with the reason', () => {
      mocks.list = listed(ALL, [{ ...webhook, url: 'https://10.0.0.5/hook', urlRefusal: 'address' }]);
      renderPage();

      expect(screen.getByText('送信先が許可されていません')).toBeInTheDocument();
      expect(
        screen.getByText(
          'この URL には送信しません（社内用または予約済みの IP アドレスです）。URL を変更してください。'
        )
      ).toBeInTheDocument();
    });

    it('shows no badge for an allowed destination', () => {
      mocks.list = listed(ALL);
      renderPage();

      expect(screen.queryByText('送信先が許可されていません')).not.toBeInTheDocument();
    });

    it('explains a refused URL when saving', async () => {
      mocks.list = listed(ALL);
      mocks.updateError = {
        message: 'destination_not_allowed (host): webhooks can only be sent to public https URLs',
        data: { code: 'BAD_REQUEST' },
      };
      renderPage();

      await userEvent.click(screen.getByRole('button', { name: '編集' }));
      const dialog = await screen.findByRole('dialog');
      await userEvent.click(within(dialog).getByRole('button', { name: '保存' }));

      expect(mocks.toastError).toHaveBeenCalledWith(
        expect.stringContaining('この URL には送信できません。')
      );
    });

    it('sends a test to the chosen webhook and reports it', async () => {
      mocks.list = listed(ALL);
      renderPage();

      await userEvent.click(screen.getByRole('button', { name: 'テスト送信' }));

      expect(mocks.test).toHaveBeenCalledWith({ organizationId: ORG_ID, id: WEBHOOK_ID });
      expect(mocks.toastSuccess).toHaveBeenCalledWith('テスト送信しました');
    });

    it('shows the limit when test sends are refused (TOO_MANY_REQUESTS)', async () => {
      mocks.list = listed(ALL);
      mocks.testError = {
        message: 'test_rate_limited: at most 3 test sends per 10 minutes (per webhook)',
        data: { code: 'TOO_MANY_REQUESTS' },
      };
      renderPage();

      await userEvent.click(screen.getByRole('button', { name: 'テスト送信' }));

      expect(mocks.toastError).toHaveBeenCalledWith(
        'テスト送信の上限に達しました（1つの Webhook につき 10 分間に 3 回、組織全体で 1 時間に 10 回、1 人あたり 1 時間に 20 回まで）。しばらくしてからもう一度お試しください。'
      );
    });
  });
});
