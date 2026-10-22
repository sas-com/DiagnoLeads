/**
 * Importing a sales agency's call report into the customer search (#161): the columns found in
 * another format, the rows sent and the result. Values are made up.
 */
import { CallReportImportDialog } from '@/components/features/prospects/call-report-import-dialog';
import messages from '@/locales/ja/common.json';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  onSuccess: undefined as undefined | ((data: unknown) => void),
}));
vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    useUtils: () => ({
      prospects: { list: { invalidate: vi.fn() }, summary: { invalidate: vi.fn() } },
    }),
    prospects: {
      importCalls: {
        useMutation: (options: { onSuccess: (data: unknown) => void }) => {
          mocks.onSuccess = options.onSuccess;
          return { mutate: mocks.mutate, isPending: false };
        },
      },
    },
  },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const ORG = '660e8400-e29b-41d4-a716-446655440000';

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
});

describe('CallReportImportDialog', () => {
  it('reads a report, skips rows without a company and imports the rest', async () => {
    const user = userEvent.setup();
    render(
      <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
        <CallReportImportDialog open onOpenChange={vi.fn()} organizationId={ORG} />
      </NextIntlClientProvider>
    );
    const csv = '企業名,結果,お断り理由,再架電時期\n架空工業,お断り,予算,2027/4/1\n,不在,,\n';
    const file = new File([csv], 'calls.csv', { type: 'text/csv' });
    // jsdom's File has no text()
    Object.defineProperty(file, 'text', { value: async () => csv });
    await user.upload(screen.getByLabelText('ファイルを選ぶ'), file);

    expect(await screen.findByText('1 行を取り込めます')).toBeInTheDocument();
    expect(screen.getByText('1 行は会社名が空のため飛ばします')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '断られた理由' })).toHaveTextContent('お断り理由');

    await user.click(screen.getByRole('button', { name: '取り込む' }));
    expect(mocks.mutate).toHaveBeenCalledWith({
      organizationId: ORG,
      rows: [
        expect.objectContaining({
          company: '架空工業',
          callResult: 'refused',
          refusalReason: 'budget',
          nextActionOn: '2027-04-01',
        }),
      ],
    });
    mocks.onSuccess?.({ added: 1, updated: 0 });
    expect(await screen.findByText('1 行を追加し、0 行を更新しました。')).toBeInTheDocument();
  });
});
