/**
 * Changing the expected close date of a deal past it, from 今日's deals that need attention
 * (#999): the dialog says the date that passed, takes one date from today on, sends it alone,
 * says it in a toast with the deal and the new date and reads the deals again; a failure is said
 * in place with the date kept. Rendered with the Japanese messages (tRPC mocked)
 */
import { DealCloseDateDialog } from '@/components/features/deals/deal-close-date-dialog';
import messages from '@/locales/ja/common.json';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const DEAL_ID = '880e8400-e29b-41d4-a716-446655440002';
const c = messages.deals.closeDate;
const SAVE = messages.deals.form.submitEdit;
const HINT = c.hint.replace('{today}', '2026/10/29');

type Callbacks = { onSuccess?: (result: unknown) => unknown; onError?: (error: Error) => unknown };

const mocks = vi.hoisted(() => ({
  updates: [] as unknown[],
  fail: false,
  // The update is on its way (isPending)
  pending: false,
  invalidated: [] as string[],
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/trpc/client', () => {
  const invalidate = (name: string) => ({
    invalidate: () => {
      mocks.invalidated.push(name);
    },
  });
  // Like TanStack Query: the hook's callbacks, then the call's promise
  const mutation = (hook: Callbacks = {}, sent?: unknown[]) => ({
    isPending: mocks.pending,
    mutate: vi.fn(),
    mutateAsync: async (input: unknown) => {
      sent?.push(input);
      if (mocks.fail) {
        const error = new Error('failed');
        hook.onError?.(error);
        throw error;
      }
      await hook.onSuccess?.(input);
      return input;
    },
  });
  return {
    trpc: {
      useUtils: () => ({
        deals: invalidate('deals'),
        leads: invalidate('leads'),
        leadActivity: invalidate('leadActivity'),
      }),
      deals: {
        create: { useMutation: (hook?: Callbacks) => mutation(hook) },
        update: { useMutation: (hook?: Callbacks) => mutation(hook, mocks.updates) },
        delete: { useMutation: (hook?: Callbacks) => mutation(hook) },
      },
    },
  };
});
vi.mock('sonner', () => ({ toast: mocks.toast }));

// The calendar (Radix) in jsdom
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture ??= () => false;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

beforeEach(() => {
  mocks.updates = [];
  mocks.fail = false;
  mocks.pending = false;
  mocks.invalidated = [];
  mocks.toast.success.mockClear();
  mocks.toast.error.mockClear();
});

const deal = { id: DEAL_ID, name: '基幹システム移行', expectedCloseOn: '2026-10-20' };

const renderDialog = (leadLabel = '架空商事') => {
  const onOpenChange = vi.fn();
  const onChanged = vi.fn();
  const ui = (open: boolean) => (
    <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
      <DealCloseDateDialog
        open={open}
        onOpenChange={onOpenChange}
        organizationId={ORG_ID}
        deal={deal}
        leadLabel={leadLabel}
        today="2026-10-29"
        onChanged={onChanged}
      />
    </NextIntlClientProvider>
  );
  const { rerender } = render(ui(true));
  return { onOpenChange, onChanged, reopen: () => (rerender(ui(false)), rerender(ui(true))) };
};

/** A press outside the dialog (Radix listens for it once the dialog has opened) */
async function pressOutside() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  fireEvent.pointerDown(document.body);
}

const dateBox = () => screen.getByLabelText(c.field);

describe('DealCloseDateDialog', () => {
  it('says the date that passed, for whose deal, and what a new date does', () => {
    renderDialog();

    const dialog = screen.getByRole('dialog', {
      name: c.title.replace('{deal}', '基幹システム移行'),
    });
    expect(dialog).toHaveAccessibleDescription(
      c.description.replace('{lead}', '架空商事').replace('{date}', '2026/10/20')
    );
    expect(dateBox()).toHaveValue('');
    // The hint is read with the box
    expect(dateBox()).toHaveAccessibleDescription(HINT);
  });

  it('names the deal only when its lead has neither a company nor a name', () => {
    renderDialog('');

    expect(screen.getByRole('dialog')).toHaveAccessibleDescription(
      c.descriptionNoName.replace('{date}', '2026/10/20')
    );
  });

  it('asks for a date, sending nothing', async () => {
    const user = userEvent.setup();
    const { onOpenChange } = renderDialog();

    await user.click(screen.getByRole('button', { name: SAVE }));

    expect(dateBox()).toHaveAccessibleDescription(`${c.required} ${HINT}`);
    expect(dateBox()).toHaveFocus();
    expect(mocks.updates).toEqual([]);
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('takes no date before today, which would leave the deal marked', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(dateBox(), '2026/10/28');
    await user.click(screen.getByRole('button', { name: SAVE }));

    expect(dateBox()).toHaveAccessibleDescription(
      `${c.notBeforeToday.replace('{today}', '2026/10/29')} ${HINT}`
    );
    expect(mocks.updates).toEqual([]);
  });

  it('takes no date the deals do not take (outside 2000 to 2100)', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(dateBox(), '2101/01/01');
    await user.click(screen.getByRole('button', { name: SAVE }));

    expect(dateBox()).toHaveAccessibleDescription(`${messages.deals.form.closeDateInvalid} ${HINT}`);
    expect(mocks.updates).toEqual([]);
  });

  it('sends the new date alone, says it, reads the deals again and closes', async () => {
    const user = userEvent.setup();
    const { onOpenChange, onChanged } = renderDialog();

    // Today itself is taken: the deal is past its date no longer
    await user.type(dateBox(), '2026/10/29');
    await user.click(screen.getByRole('button', { name: SAVE }));

    expect(mocks.updates).toEqual([
      { organizationId: ORG_ID, dealId: DEAL_ID, expectedCloseOn: '2026-10-29' },
    ]);
    expect(mocks.toast.success).toHaveBeenCalledWith(
      c.saved.replace('{name}', '基幹システム移行').replace('{date}', '2026/10/29'),
      { description: '架空商事' }
    );
    // The board of 今日 is one of the deals' queries
    expect(mocks.invalidated).toEqual(expect.arrayContaining(['deals', 'leads', 'leadActivity']));
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('says a failure in place, the date and the dialog kept', async () => {
    mocks.fail = true;
    const user = userEvent.setup();
    const { onOpenChange, onChanged } = renderDialog();

    await user.type(dateBox(), '2026/11/15');
    await user.click(screen.getByRole('button', { name: SAVE }));

    expect(screen.getByRole('alert')).toHaveTextContent(messages.deals.toasts.error);
    expect(dateBox()).toHaveValue('2026/11/15');
    expect(onChanged).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
    // Said in the dialog only
    expect(mocks.toast.error).not.toHaveBeenCalled();
  });

  it('saves on Enter in the box, as its only field', async () => {
    const user = userEvent.setup();
    const { onOpenChange } = renderDialog();

    await user.type(dateBox(), '2026/11/15{Enter}');

    expect(mocks.updates).toEqual([
      { organizationId: ORG_ID, dealId: DEAL_ID, expectedCloseOn: '2026-11-15' },
    ]);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('says that it is saving, and does not close meanwhile', async () => {
    mocks.pending = true;
    const { onOpenChange } = renderDialog();

    const saving = screen.getByRole('button', { name: messages.deals.form.saving });
    expect(saving).toBeDisabled();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('does not close on a press outside once a date was entered', async () => {
    const user = userEvent.setup();
    const { onOpenChange } = renderDialog();

    await user.type(dateBox(), '2026/11/15');
    await pressOutside();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('starts clean when it opens again: a date entered before does not hold a press outside', async () => {
    const user = userEvent.setup();
    const { onOpenChange, reopen } = renderDialog();

    await user.type(dateBox(), '2026/11/15');
    reopen();
    expect(dateBox()).toHaveValue('');
    await pressOutside();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
