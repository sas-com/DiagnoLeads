/**
 * The inline failure of a list or a card (#431): it says the content could not be read, and its
 * retry is tall enough to tap on a phone (#1059)
 */
import { InlineLoadError } from '@/components/common/inline-load-error';
import messages from '@/locales/ja/common.json';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';

const renderError = (onRetry?: () => void) =>
  render(
    <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
      <InlineLoadError onRetry={onRetry} />
    </NextIntlClientProvider>
  );

describe('InlineLoadError', () => {
  it('says the failure, and asks again with a retry of 44px on a phone', async () => {
    const onRetry = vi.fn();
    const user = userEvent.setup();
    renderError(onRetry);

    expect(screen.getByRole('alert')).toHaveTextContent(messages.common.loadError);
    const retry = screen.getByRole('button', { name: messages.common.retry });
    expect(retry).toHaveClass('min-h-11');
    await user.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('has no retry without a way to ask again', () => {
    renderError();

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
