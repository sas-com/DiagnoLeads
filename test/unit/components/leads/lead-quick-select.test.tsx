/**
 * Status badge of a lead: moving a lead to nurturing warns when nothing brings it back (#446)
 */
import { LeadQuickSelect } from '@/components/features/leads/lead-quick-select';
import messages from '@/locales/ja/common.json';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mutateAsync = vi.fn();
const fetchTasks = vi.fn();
const warning = vi.fn();

vi.mock('@/hooks/use-leads', () => ({ useUpdateLead: () => ({ mutateAsync }) }));
vi.mock('@/lib/trpc/client', () => ({
  trpc: { useUtils: () => ({ leadFollowUp: { tasks: { fetch: fetchTasks } } }) },
}));
vi.mock('sonner', () => ({ toast: { warning: (...args: unknown[]) => warning(...args) } }));

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture ??= () => false;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const lead = { id: '22222222-2222-4222-8222-222222222222', status: 'new', dealPhase: null };

async function moveToNurturing() {
  const user = userEvent.setup();
  render(
    <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
      <LeadQuickSelect field="status" lead={lead} organizationId={ORG_ID} canEdit />
    </NextIntlClientProvider>
  );
  await user.click(screen.getByRole('combobox'));
  await user.click(screen.getByRole('option', { name: messages.status.nurturing }));
  await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
}

describe('LeadQuickSelect: moving to nurturing (#446)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('warns when the lead has no open next action and no month to act', async () => {
    mutateAsync.mockResolvedValue({ ...lead, status: 'nurturing', actBy: null });
    fetchTasks.mockResolvedValue({ items: [{ done: true }] });
    await moveToNurturing();
    await waitFor(() =>
      expect(warning).toHaveBeenCalledWith(messages.leadDetail.quick.nurturingWithoutFollowUp)
    );
    expect(fetchTasks).toHaveBeenCalledWith({ organizationId: ORG_ID, leadId: lead.id });
  });

  it('says nothing when an open next action brings the lead back', async () => {
    mutateAsync.mockResolvedValue({ ...lead, status: 'nurturing', actBy: null });
    fetchTasks.mockResolvedValue({ items: [{ done: false }] });
    await moveToNurturing();
    await waitFor(() => expect(fetchTasks).toHaveBeenCalled());
    expect(warning).not.toHaveBeenCalled();
  });

  it('says nothing when the lead has a month to act', async () => {
    mutateAsync.mockResolvedValue({ ...lead, status: 'nurturing', actBy: '2027-04-01' });
    await moveToNurturing();
    expect(fetchTasks).not.toHaveBeenCalled();
    expect(warning).not.toHaveBeenCalled();
  });
});
