/**
 * AX sales playbook editor (real next-intl messages, tRPC mocked) — Refs #74
 */
import { AxPlaybookEditor } from '@/components/features/ax-playbook/ax-playbook-editor';
import { emptyAxPlaybookContent } from '@/lib/features/ax-playbook/types/schemas';
import messages from '@/locales/ja/common.json';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  targetMutate: vi.fn(),
  toastError: vi.fn(),
  data: undefined as unknown,
  isError: false,
  organizationId: '660e8400-e29b-41d4-a716-446655440000',
  onSuccess: undefined as undefined | ((result: unknown, variables: unknown) => void),
}));

vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    useUtils: () => ({ axPlaybook: { get: { invalidate: vi.fn() } } }),
    axPlaybook: {
      get: {
        useQuery: () => ({
          data: mocks.isError ? undefined : mocks.data,
          isLoading: false,
          isError: mocks.isError,
          refetch: vi.fn(),
        }),
      },
      update: {
        useMutation: (options: { onSuccess: (result: unknown, variables: unknown) => void }) => {
          mocks.onSuccess = options.onSuccess;
          return { mutate: mocks.mutate, isPending: false };
        },
      },
      updateTargetCompany: {
        useMutation: () => ({ mutate: mocks.targetMutate, isPending: false }),
      },
    },
  },
}));
vi.mock('@/hooks/use-organization', () => ({
  useOrganization: () => ({ organization: { id: mocks.organizationId } }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: mocks.toastError } }));

// A new element each time, so rerender() really renders again
const editor = () => (
  <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
    <AxPlaybookEditor />
  </NextIntlClientProvider>
);
const renderEditor = () => render(editor());

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isError = false;
  mocks.organizationId = ORG_ID;
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

  it('saves the target company size ranges on their own (#150)', async () => {
    const content = emptyAxPlaybookContent();
    content.targetCompany.employees = ['300_999'];
    mocks.data = { content, updatedAt: null, canEdit: true, canEditTargetCompany: true };
    const user = userEvent.setup();
    renderEditor();

    expect(screen.getAllByText('条件なし')).toHaveLength(2);
    await user.click(screen.getByRole('checkbox', { name: '30億〜100億円未満' }));
    await user.click(screen.getByRole('checkbox', { name: '10億〜30億円未満' }));
    await user.click(screen.getByRole('checkbox', { name: '300〜999名' }));
    await user.click(screen.getByRole('button', { name: '範囲を保存' }));

    expect(mocks.targetMutate).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      targetCompany: { annual_revenue: ['3b_10b', '1b_3b'], employees: [], sites: [] },
    });
    // Saving the playbook does not send the ranges (the server keeps the stored ones)
    await user.click(screen.getByRole('button', { name: '保存' }));
    expect(mocks.mutate).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      content: emptyAxPlaybookContent(),
    });
  });

  it('lets a member who cannot edit the playbook change the target ranges', async () => {
    mocks.data = {
      content: emptyAxPlaybookContent(),
      updatedAt: null,
      canEdit: false,
      canEditTargetCompany: true,
    };
    const user = userEvent.setup();
    renderEditor();

    expect(screen.queryByRole('button', { name: '保存' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: '5〜9か所' }));
    await user.click(screen.getByRole('button', { name: '範囲を保存' }));
    expect(mocks.targetMutate).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      targetCompany: { annual_revenue: [], employees: [], sites: ['5_9'] },
    });
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
    rerender(editor());

    expect(screen.getByLabelText('深掘りの質問')).toHaveValue('draft');
  });

  it('shows what was stored after saving (blank rows dropped)', async () => {
    mocks.data = { content: null, updatedAt: null, canEdit: true };
    const user = userEvent.setup();
    renderEditor();

    await user.click(screen.getAllByRole('button', { name: '行を追加' })[0]);
    expect(screen.getByLabelText('お客様の声')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '保存' }));
    const variables = mocks.mutate.mock.calls[0][0];
    act(() => mocks.onSuccess?.({}, variables));

    expect(screen.queryByLabelText('お客様の声')).not.toBeInTheDocument();
  });

  // Checks the end state only: the one render before the effect runs is guarded in the
  // component (loadedFor), which a test cannot observe because effects flush inside act()
  it('shows the new organization playbook after switching', async () => {
    const first = emptyAxPlaybookContent();
    first.challenges.people.questions = ['org A secret'];
    mocks.data = { content: first, updatedAt: null, canEdit: true };
    const { rerender } = renderEditor();
    expect(screen.getByLabelText('深掘りの質問')).toHaveValue('org A secret');

    mocks.organizationId = '990e8400-e29b-41d4-a716-446655440000';
    mocks.data = { content: emptyAxPlaybookContent(), updatedAt: null, canEdit: true };
    rerender(editor());

    expect(screen.getByLabelText('深掘りの質問')).toHaveValue('');
  });

  it('shows an error with a retry when loading fails', () => {
    mocks.isError = true;
    renderEditor();

    expect(screen.getByText('手引きを読み込めませんでした')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '再読み込み' })).toBeInTheDocument();
  });

  it('warns when the stored playbook could not be read', () => {
    mocks.data = { content: null, storedInvalid: true, updatedAt: null, canEdit: true };
    renderEditor();

    expect(screen.getByText('保存済みの手引きを読み込めませんでした')).toBeInTheDocument();
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
