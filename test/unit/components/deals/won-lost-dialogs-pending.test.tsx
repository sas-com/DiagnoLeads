/**
 * The won and lost questions while they save (#1058): the button pressed keeps the focus, as it
 * is aria-disabled rather than disabled, and pressing it again sends nothing (real next-intl
 * messages and UI components)
 */
import { LostReasonDialog } from '@/components/features/deals/lost-reason-dialog';
import { WonDialog } from '@/components/features/deals/won-dialog';
import messages from '@/locales/ja/common.json';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture ??= () => false;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

const SAVING = messages.deals.form.saving;

const withIntl = (node: ReactNode) => (
  <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
    {node}
  </NextIntlClientProvider>
);

describe('while the question is saved (#1058)', () => {
  it('keeps the focus on 受注にする, and sends the win once', async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    const won = (pending: boolean) =>
      withIntl(
        <WonDialog
          open
          onOpenChange={vi.fn()}
          dealName="AS/400 現行調査"
          leadLabel="架空商事"
          amount={3_000_000}
          pending={pending}
          onConfirm={onConfirm}
        />
      );
    const { rerender } = render(won(false));
    await user.click(screen.getByRole('button', { name: '受注にする' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    rerender(won(true));
    const saving = screen.getByRole('button', { name: SAVING });
    expect(saving).toHaveFocus();
    expect(saving).toHaveAttribute('aria-disabled', 'true');
    expect(saving).not.toBeDisabled();

    await user.click(saving);
    await user.keyboard('{Enter}');
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('keeps the focus on 失注にする, and sends the loss once', async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    const lost = (pending: boolean) =>
      withIntl(
        <LostReasonDialog
          open
          onOpenChange={vi.fn()}
          dealName="AS/400 現行調査"
          initial={{ lostReason: 'no_need' }}
          pending={pending}
          onConfirm={onConfirm}
        />
      );
    const { rerender } = render(lost(false));
    await user.click(screen.getByRole('button', { name: '失注にする' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    rerender(lost(true));
    const saving = screen.getByRole('button', { name: SAVING });
    expect(saving).toHaveFocus();
    expect(saving).toHaveAttribute('aria-disabled', 'true');
    expect(saving).not.toBeDisabled();

    await user.click(saving);
    await user.keyboard('{Enter}');
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
