/**
 * Field glossary settings page (real ja messages, tRPC mocked) — Epic #780 P0b, #800
 *
 * The dictionary is site-wide, so the page sends no organizationId. A user who may not edit it
 * (the list query answers FORBIDDEN) sees 「権限がありません」. The entries are grouped by field key,
 * with the field-level entry (value null) marked 「項目全体」 and each value entry showing its value.
 * Creating with a blank value calls upsert with value null (the server treats it as field-level).
 */
import FieldGlossarySettingsPage from '@/app/[locale]/(dashboard)/settings/field-glossary/page';
import messages from '@/locales/ja/common.json';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type ListResult = {
  data?: { entries: unknown[] };
  isLoading: boolean;
  error: { data: { code: string } } | null;
};

const FIELD_LEVEL_ID = '550e8400-e29b-41d4-a716-446655440001';
const VALUE_ID = '550e8400-e29b-41d4-a716-446655440002';

const mocks = vi.hoisted(() => ({
  list: undefined as unknown as ListResult,
  upsert: vi.fn(),
  remove: vi.fn(),
  invalidate: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('sonner', () => ({ toast: { success: mocks.toastSuccess, error: mocks.toastError } }));
vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    useUtils: () => ({ fieldGlossary: { list: { invalidate: mocks.invalidate } } }),
    fieldGlossary: {
      list: { useQuery: () => mocks.list },
      upsert: {
        useMutation: (options: {
          onSuccess?: (entry: unknown, variables: { id?: string }) => void;
        }) => ({
          mutate: (input: { id?: string }) => {
            mocks.upsert(input);
            options.onSuccess?.({ id: input.id ?? FIELD_LEVEL_ID }, input);
          },
          isPending: false,
        }),
      },
      delete: {
        useMutation: (options: { onSuccess?: () => void }) => ({
          mutate: (input: unknown) => {
            mocks.remove(input);
            options.onSuccess?.();
          },
          isPending: false,
        }),
      },
    },
  },
}));

const fieldLevelEntry = {
  id: FIELD_LEVEL_ID,
  fieldKey: 'leads.status',
  value: null,
  labelJa: null,
  labelEn: null,
  descriptionJa: 'リードの進捗状況を表す項目です',
  descriptionEn: 'The stage of the lead',
  sortOrder: 0,
  updatedBy: 'user-1',
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-01T00:00:00Z',
};

const valueEntry = {
  id: VALUE_ID,
  fieldKey: 'leads.status',
  value: 'negotiating',
  labelJa: '商談中',
  labelEn: 'Negotiating',
  descriptionJa: '商談を進めている段階',
  descriptionEn: 'In negotiation',
  sortOrder: 1,
  updatedBy: 'user-1',
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-01T00:00:00Z',
};

const listed = (entries: unknown[]): ListResult => ({
  data: { entries },
  isLoading: false,
  error: null,
});

/** Put a value into an input in one step (clear, then paste) — see the webhooks page test (#573) */
const fill = async (input: HTMLElement, text: string) => {
  await userEvent.clear(input);
  await userEvent.paste(text);
};

const renderPage = () =>
  render(
    <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
      <FieldGlossarySettingsPage />
    </NextIntlClientProvider>
  );

beforeEach(() => {
  vi.clearAllMocks();
});

describe('FieldGlossarySettingsPage', () => {
  it('lists the entries grouped by field key, marking the field-level entry and the values', () => {
    mocks.list = listed([fieldLevelEntry, valueEntry]);
    renderPage();

    expect(screen.getByText('leads.status')).toBeInTheDocument();
    // The field-level entry (value null) is marked, not shown as a value
    expect(screen.getByText('項目全体')).toBeInTheDocument();
    expect(screen.getByText('リードの進捗状況を表す項目です')).toBeInTheDocument();
    // The value entry shows its value, its label and its description
    expect(screen.getByText('negotiating')).toBeInTheDocument();
    expect(screen.getByText('商談中')).toBeInTheDocument();
    expect(screen.getByText('商談を進めている段階')).toBeInTheDocument();
  });

  it('shows 「権限がありません」 when editing is refused (FORBIDDEN)', () => {
    mocks.list = { data: undefined, isLoading: false, error: { data: { code: 'FORBIDDEN' } } };
    renderPage();

    expect(screen.getByText('権限がありません')).toBeInTheDocument();
    expect(
      screen.getByText('項目辞書を編集できるのは、運営組織のオーナーと管理者だけです。')
    ).toBeInTheDocument();
    // No way to add while refused
    expect(screen.queryByRole('button', { name: '追加' })).not.toBeInTheDocument();
  });

  it('creates an entry with a blank value, sending value null (the field-level entry)', async () => {
    mocks.list = listed([]);
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: '追加' }));
    const dialog = await screen.findByRole('dialog');

    await fill(within(dialog).getByLabelText('項目キー'), 'leads.status');
    await fill(within(dialog).getByLabelText('説明（日本語）'), 'リードの進捗状況');
    // Value is left blank on purpose
    await userEvent.click(within(dialog).getByRole('button', { name: '作成' }));

    expect(mocks.upsert).toHaveBeenCalledWith({
      fieldKey: 'leads.status',
      value: null,
      labelJa: '',
      labelEn: '',
      descriptionJa: 'リードの進捗状況',
      descriptionEn: '',
      sortOrder: 0,
    });
    expect(mocks.toastSuccess).toHaveBeenCalledWith('追加しました');
  });

  it('creates a value entry, sending the value and including it as a candidate', async () => {
    mocks.list = listed([]);
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: '追加' }));
    const dialog = await screen.findByRole('dialog');

    await fill(within(dialog).getByLabelText('項目キー'), 'leads.status');
    await fill(within(dialog).getByLabelText('値'), 'negotiating');
    await fill(within(dialog).getByLabelText('説明（日本語）'), '商談を進めている段階');
    await userEvent.click(within(dialog).getByRole('button', { name: '作成' }));

    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ fieldKey: 'leads.status', value: 'negotiating' })
    );
  });

  it('edits an entry, sending its id', async () => {
    mocks.list = listed([fieldLevelEntry, valueEntry]);
    renderPage();

    const [firstEdit] = screen.getAllByRole('button', { name: '編集' });
    await userEvent.click(firstEdit);
    const dialog = await screen.findByRole('dialog');

    expect(within(dialog).getByLabelText('項目キー')).toHaveValue('leads.status');
    await userEvent.click(within(dialog).getByRole('button', { name: '保存' }));

    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({ id: FIELD_LEVEL_ID }));
    expect(mocks.toastSuccess).toHaveBeenCalledWith('更新しました');
  });

  it('deletes an entry after confirming', async () => {
    mocks.list = listed([fieldLevelEntry]);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: '削除' }));

    expect(confirm).toHaveBeenCalled();
    expect(mocks.remove).toHaveBeenCalledWith({ id: FIELD_LEVEL_ID });
    expect(mocks.toastSuccess).toHaveBeenCalledWith('削除しました');
    confirm.mockRestore();
  });
});
