/**
 * The lead import's preview with the input limits (#575): a row with a value over its limit
 * names the file's column and tells the limit in the page's language, and only the other rows
 * are sent to leads.bulkCreate. Values are made up.
 */
import { ImportDialog } from '@/components/features/leads/import-dialog';
import enMessages from '@/locales/en/common.json';
import jaMessages from '@/locales/ja/common.json';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mutate = vi.hoisted(() => vi.fn());
vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    leads: {
      bulkCreate: { useMutation: () => ({ mutate, isPending: false }) },
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
  mutate.mockReset();
});

async function previewCsv(locale: 'ja' | 'en') {
  const messages = locale === 'ja' ? jaMessages : enMessages;
  const user = userEvent.setup();
  render(
    <NextIntlClientProvider locale={locale} messages={messages} timeZone="Asia/Tokyo">
      <ImportDialog open onOpenChange={vi.fn()} organizationId={ORG_ID} onSuccess={vi.fn()} />
    </NextIntlClientProvider>
  );
  const file = new File([CSV], 'leads.csv', { type: 'text/csv' });
  // jsdom's File has no text()
  Object.defineProperty(file, 'text', { value: async () => CSV });
  await user.upload(screen.getByLabelText(messages.leads.import.selectFile), file);
  return { user, messages, rows: await screen.findAllByRole('row') };
}

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

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      leads: [expect.objectContaining({ email: 'yamada@example.jp', company: '三田製作所' })],
    });
  });
});
