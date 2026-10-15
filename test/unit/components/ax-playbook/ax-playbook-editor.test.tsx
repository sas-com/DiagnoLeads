/**
 * AX sales playbook editor (real next-intl messages, tRPC mocked) — Refs #74
 */
import { AxPlaybookEditor } from '@/components/features/ax-playbook/ax-playbook-editor';
import { emptyAxPlaybookContent } from '@/lib/features/ax-playbook/types/schemas';
import messages from '@/locales/ja/common.json';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  toastError: vi.fn(),
  data: undefined as unknown,
}));

vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    useUtils: () => ({ axPlaybook: { get: { invalidate: vi.fn() } } }),
    axPlaybook: {
      get: { useQuery: () => ({ data: mocks.data, isLoading: false }) },
      update: { useMutation: () => ({ mutate: mocks.mutate, isPending: false }) },
    },
  },
}));
vi.mock('@/hooks/use-organization', () => ({
  useOrganization: () => ({ organization: { id: ORG_ID } }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: mocks.toastError } }));

const renderEditor = () =>
  render(
    <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
      <AxPlaybookEditor />
    </NextIntlClientProvider>
  );

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AxPlaybookEditor', () => {
  it('lets an editor fill in and save the playbook', async () => {
    mocks.data = { content: null, updatedAt: null, canEdit: true };
    const user = userEvent.setup();
    renderEditor();

    await user.type(screen.getByLabelText('深掘りの質問'), 'Q1{enter}Q2');
    await user.click(screen.getAllByRole('button', { name: '行を追加' })[0]);
    await user.type(screen.getByLabelText('お客様の声'), 'C');
    await user.type(screen.getByLabelText('切り返し例'), 'R');
    await user.click(screen.getByRole('button', { name: '保存' }));

    const expected = emptyAxPlaybookContent();
    expected.challenges.people.questions = ['Q1', 'Q2'];
    expected.objections = [{ customer: 'C', response: 'R', note: '' }];
    expect(mocks.mutate).toHaveBeenCalledWith({ organizationId: ORG_ID, content: expected });
  });

  it('does not save a table row with a required field left blank', async () => {
    mocks.data = { content: null, updatedAt: null, canEdit: true };
    const user = userEvent.setup();
    renderEditor();

    await user.click(screen.getAllByRole('button', { name: '行を追加' })[0]);
    await user.type(screen.getByLabelText('お客様の声'), 'C');
    await user.click(screen.getByRole('button', { name: '保存' }));

    expect(mocks.mutate).not.toHaveBeenCalled();
    expect(mocks.toastError).toHaveBeenCalled();
  });

  it('keeps unsaved edits when the playbook is refetched', async () => {
    mocks.data = { content: null, updatedAt: null, canEdit: true };
    const user = userEvent.setup();
    const { rerender } = renderEditor();

    await user.type(screen.getByLabelText('深掘りの質問'), 'draft');
    const refetched = emptyAxPlaybookContent();
    refetched.challenges.people.questions = ['saved elsewhere'];
    mocks.data = { content: refetched, updatedAt: '2026-10-15T01:00:00Z', canEdit: true };
    rerender(
      <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
        <AxPlaybookEditor />
      </NextIntlClientProvider>
    );

    expect(screen.getByLabelText('深掘りの質問')).toHaveValue('draft');
  });

  it('shows the playbook read-only to those who cannot edit', () => {
    const content = emptyAxPlaybookContent();
    content.challenges.people.questions = ['Q1'];
    mocks.data = { content, updatedAt: '2026-10-15T00:00:00Z', canEdit: false };
    renderEditor();

    expect(screen.getByText('閲覧のみ')).toBeInTheDocument();
    expect(screen.getByLabelText('深掘りの質問')).toHaveAttribute('readonly');
    expect(screen.getByLabelText('深掘りの質問')).toHaveValue('Q1');
    expect(screen.queryByRole('button', { name: '保存' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '行を追加' })).not.toBeInTheDocument();
  });
});
