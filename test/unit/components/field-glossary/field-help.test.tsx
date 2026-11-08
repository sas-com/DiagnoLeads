/**
 * <FieldHelp> (Epic #780 P0b): an info icon that opens a popover with a field's or a value's
 * description from the site-wide glossary. The tRPC read is mocked; the hook and locale selection
 * run for real through NextIntlClientProvider. Renders nothing while loading or with no entry.
 */
import { FieldHelp } from '@/components/features/field-glossary/field-help';
import enMessages from '@/locales/en/common.json';
import jaMessages from '@/locales/ja/common.json';
import { fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Entry = { value: string | null; descriptionJa: string | null; descriptionEn: string | null };

const q = vi.hoisted(() => ({
  data: undefined as { entries: Entry[] } | undefined,
  isLoading: false,
}));

vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    fieldGlossary: {
      getByKeys: { useQuery: () => ({ data: q.data, isLoading: q.isLoading }) },
    },
  },
}));

const jaHelp = jaMessages.fieldGlossary.help;

function renderHelp(props: { fieldKey: string; value?: string }, locale: 'ja' | 'en' = 'ja') {
  const messages = locale === 'en' ? enMessages : jaMessages;
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <FieldHelp {...props} />
    </NextIntlClientProvider>
  );
}

beforeEach(() => {
  q.data = undefined;
  q.isLoading = false;
});

describe('FieldHelp', () => {
  it('renders nothing while the glossary is loading', () => {
    q.isLoading = true;
    const { container } = renderHelp({ fieldKey: 'leads.status' });
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the field has no entry', () => {
    q.data = { entries: [] };
    const { container } = renderHelp({ fieldKey: 'leads.status' });
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the field's description in a popover", async () => {
    q.data = { entries: [{ value: null, descriptionJa: 'リードの営業段階', descriptionEn: null }] };
    renderHelp({ fieldKey: 'leads.status' });
    fireEvent.click(screen.getByRole('button', { name: jaHelp }));
    expect(await screen.findByText('リードの営業段階')).toBeInTheDocument();
  });

  it('shows a value description, not the field description, when a value is given', async () => {
    q.data = {
      entries: [
        { value: null, descriptionJa: 'リードの営業段階', descriptionEn: null },
        { value: 'negotiating', descriptionJa: '商談を進めている段階', descriptionEn: null },
      ],
    };
    renderHelp({ fieldKey: 'leads.status', value: 'negotiating' });
    fireEvent.click(screen.getByRole('button', { name: jaHelp }));
    expect(await screen.findByText('商談を進めている段階')).toBeInTheDocument();
    expect(screen.queryByText('リードの営業段階')).not.toBeInTheDocument();
  });

  it('renders nothing for a value the glossary does not have', () => {
    q.data = { entries: [{ value: null, descriptionJa: 'リードの営業段階', descriptionEn: null }] };
    const { container } = renderHelp({ fieldKey: 'leads.status', value: 'unknown' });
    expect(container).toBeEmptyDOMElement();
  });

  it('uses the English description in the en locale', async () => {
    q.data = {
      entries: [
        { value: null, descriptionJa: 'リードの営業段階', descriptionEn: 'Lead sales stage' },
      ],
    };
    renderHelp({ fieldKey: 'leads.status' }, 'en');
    fireEvent.click(screen.getByRole('button', { name: enMessages.fieldGlossary.help }));
    expect(await screen.findByText('Lead sales stage')).toBeInTheDocument();
    expect(screen.queryByText('リードの営業段階')).not.toBeInTheDocument();
  });
});
