/**
 * Webhook settings page (real ja messages, tRPC mocked) — #314
 *
 * A user without the right to view webhooks sees 「権限がありません」 instead of the empty state;
 * the create, edit, pause and delete buttons appear only for those allowed to use them; stored
 * header values are never on the page, and the edit form keeps or replaces each one.
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

const mocks = vi.hoisted(() => ({
  list: undefined as unknown as ListResult,
  update: vi.fn(),
  create: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('@/hooks/use-organization', () => ({
  useOrganization: () => ({ organization: { id: ORG_ID }, isLoading: false }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    useUtils: () => ({ webhooks: { list: { invalidate: vi.fn() } } }),
    webhooks: {
      list: { useQuery: () => mocks.list },
      create: { useMutation: () => ({ mutate: mocks.create, isPending: false }) },
      update: { useMutation: () => ({ mutate: mocks.update, isPending: false }) },
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
});
