/**
 * The lead import's preview with the input limits (#575): a row with a value over its limit
 * names the file's column and tells the limit in the page's language, and only the other rows
 * are sent to leads.bulkCreate. A file larger than one request goes in parts of
 * LEAD_BULK_CREATE_MAX (#604). Values are made up.
 */
import { ImportDialog } from '@/components/features/leads/import-dialog';
import { LEAD_BULK_CREATE_MAX } from '@/lib/features/leads/types/schemas';
import enMessages from '@/locales/en/common.json';
import jaMessages from '@/locales/ja/common.json';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { toast } from 'sonner';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mutateAsync = vi.hoisted(() => vi.fn());
vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    leads: {
      bulkCreate: { useMutation: () => ({ mutateAsync, isPending: false }) },
    },
  },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const LONG_COMPANY = '株'.repeat(201);
const CSV = [
  'メールアドレス,氏名,会社名',
  'yamada@example.jp,山田 太郎,三田製作所',
  `sato@example.jp,佐藤 花子,${LONG_COMPANY}`,
].join('\n');

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
});

beforeEach(() => {
  vi.clearAllMocks();
  // leads.bulkCreate creates every lead it is sent
  mutateAsync.mockImplementation(async ({ leads }: { leads: unknown[] }) => ({
    success: true,
    createdCount: leads.length,
  }));
});

async function previewCsv(locale: 'ja' | 'en', csv = CSV) {
  const messages = locale === 'ja' ? jaMessages : enMessages;
  const user = userEvent.setup();
  const onSuccess = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <NextIntlClientProvider locale={locale} messages={messages} timeZone="Asia/Tokyo">
      <ImportDialog
        open
        onOpenChange={onOpenChange}
        organizationId={ORG_ID}
        onSuccess={onSuccess}
      />
    </NextIntlClientProvider>
  );
  const file = new File([csv], 'leads.csv', { type: 'text/csv' });
  // jsdom's File has no text()
  Object.defineProperty(file, 'text', { value: async () => csv });
  await user.upload(screen.getByLabelText(messages.leads.import.selectFile), file);
  return { user, messages, onSuccess, onOpenChange, rows: await screen.findAllByRole('row') };
}

/** The import button's name for `count` leads on the Japanese page */
const importButtonName = (count: number) =>
  jaMessages.leads.import.importButton.replace('{count}', String(count));

/** A file of `count` valid leads, then one row with an invalid address */
function largeCsv(count: number) {
  const rows = Array.from({ length: count }, (_, i) => `lead${i}@example.jp,三田製作所`);
  return ['メールアドレス,会社名', ...rows, 'not-an-email,三田製作所'].join('\n');
}

/** The addresses sent in each call of leads.bulkCreate */
const sentEmails = () =>
  mutateAsync.mock.calls.map(([input]: [{ leads: { email: string }[] }]) =>
    input.leads.map((lead) => lead.email)
  );

describe('ImportDialog with the input limits (#575)', () => {
  it('names the over-long column and tells the limit in English', async () => {
    const { rows } = await previewCsv('en');

    // The header row, then one row per lead of the file
    const overLong = rows[2];
    expect(within(overLong).getByText('会社名')).toBeInTheDocument();
    expect(within(overLong).getByText(/Maximum 200 characters allowed/)).toBeInTheDocument();
    expect(overLong).not.toHaveTextContent('最大');
  });

  it('tells the limit in Japanese and sends only the row within the limits', async () => {
    const { user, messages, rows } = await previewCsv('ja');

    expect(within(rows[2]).getByText(/最大200文字までです/)).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', {
        name: messages.leads.import.importButton.replace('{count}', '1'),
      })
    );

    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(mutateAsync).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      leads: [expect.objectContaining({ email: 'yamada@example.jp', company: '三田製作所' })],
    });
  });
});

describe('ImportDialog with a file larger than one request (#604)', () => {
  const COUNT = 2 * LEAD_BULK_CREATE_MAX + 500;

  it('sends the valid rows in parts of LEAD_BULK_CREATE_MAX, in order, and tells the total', async () => {
    const { user, messages, onSuccess } = await previewCsv('ja', largeCsv(COUNT));

    await user.click(screen.getByRole('button', { name: importButtonName(COUNT) }));

    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    const sent = sentEmails();
    expect(sent.map((emails) => emails.length)).toEqual([1_000, 1_000, 500]);
    expect(sent.flat()).toEqual(Array.from({ length: COUNT }, (_, i) => `lead${i}@example.jp`));
    expect(toast.success).toHaveBeenCalledWith(
      messages.leads.import.importSuccess.replace('{count}', String(COUNT))
    );
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('keeps only the rows not created when a part fails, and imports them again without the others', async () => {
    // The second part fails before it is created (the rate limit, a request that never
    // reached the server): the first is created
    mutateAsync
      .mockImplementationOnce(async ({ leads }: { leads: unknown[] }) => ({
        success: true,
        createdCount: leads.length,
      }))
      .mockRejectedValueOnce(new Error('Too many requests'));
    const { user, messages, onSuccess } = await previewCsv('ja', largeCsv(COUNT));

    await user.click(screen.getByRole('button', { name: importButtonName(COUNT) }));

    // The created part is listed and told; the rest waits in the preview
    const retry = await screen.findByRole('button', {
      name: importButtonName(COUNT - LEAD_BULK_CREATE_MAX),
    });
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith(
      messages.leads.import.importSuccess.replace('{count}', String(LEAD_BULK_CREATE_MAX))
    );
    expect(toast.error).toHaveBeenCalledWith(messages.leads.import.importError);
    expect(screen.getAllByRole('row')[1]).toHaveTextContent('lead1000@example.jp');

    mutateAsync.mockClear();
    await user.click(retry);

    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(2));
    const sent = sentEmails();
    expect(sent.map((emails) => emails.length)).toEqual([1_000, 500]);
    expect(sent.flat()[0]).toBe('lead1000@example.jp');
    expect(sent.flat()).not.toContain('lead999@example.jp');
  });

  it('stays open while the parts are sent, so closing cannot leave the rest being sent', async () => {
    // The first part is answered only when the test lets it
    let answerFirstPart = () => {};
    mutateAsync.mockImplementationOnce(async ({ leads }: { leads: unknown[] }) => {
      await new Promise<void>((resolve) => {
        answerFirstPart = () => resolve();
      });
      return { success: true, createdCount: leads.length };
    });
    const { user, messages, onSuccess, onOpenChange } = await previewCsv('ja', largeCsv(COUNT));

    await user.click(screen.getByRole('button', { name: importButtonName(COUNT) }));
    expect(await screen.findByText(messages.leads.import.importing)).toBeInTheDocument();

    // Cancel, Escape and the close button do not close the dialog while a part is on its way
    const cancel = screen.getByRole('button', { name: messages.common.cancel });
    expect(cancel).toBeDisabled();
    await user.click(cancel);
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: '閉じる' }));
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByText(messages.leads.import.importing)).toBeInTheDocument();
    expect(mutateAsync).toHaveBeenCalledTimes(1);

    answerFirstPart();

    // Every part is sent once, then the dialog closes itself
    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(sentEmails().map((emails) => emails.length)).toEqual([1_000, 1_000, 500]);
    expect(onOpenChange).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
