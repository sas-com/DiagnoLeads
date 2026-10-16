/**
 * Lead assignee in place and the intake settings (#135). Real next-intl messages and UI
 * components; the assignee hooks are mocked.
 */
import { LeadAssigneeSelect } from '@/components/features/leads/lead-assignee-select';
import { LeadIntakeSettings } from '@/components/features/leads/lead-intake-settings';
import messages from '@/locales/ja/common.json';
import { configure, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

configure({ asyncUtilTimeout: 5000 });

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const LEAD_ID = '22222222-2222-4222-8222-222222222222';
const SATO = '33333333-3333-4333-8333-333333333333';
const SUZUKI = '44444444-4444-4444-8444-444444444444';
const FORMER = '55555555-5555-4555-8555-555555555555';

const state = vi.hoisted(() => ({
  members: [] as { userId: string; name: string | null; email: string; displayName: string }[],
  assign: vi.fn(),
  intake: { userIds: [] as string[], canEdit: true },
  setIntake: vi.fn(),
}));

vi.mock('@/hooks/use-lead-assignee', () => ({
  useLeadAssignees: () => ({ data: state.members, isLoading: false }),
  useCurrentLeadAssignees: () => ({ data: state.members, isLoading: false }),
  useAssignLead: () => ({ mutateAsync: state.assign, isPending: false }),
  useLeadIntake: () => ({ data: state.intake, isLoading: false }),
  useSetLeadIntake: () => ({ mutate: state.setIntake, isPending: false }),
}));

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  state.members = [
    { userId: SATO, name: '佐藤 花子', email: 'sato@example.com', displayName: '佐藤 花子' },
    { userId: SUZUKI, name: null, email: 'suzuki@example.com', displayName: 'suzuki@example.com' },
  ];
  state.assign.mockResolvedValue({});
  state.intake = { userIds: [], canEdit: true };
});

const wrap = (node: ReactNode) =>
  render(
    <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
      {node}
    </NextIntlClientProvider>
  );

const lead = (assigneeUserId: string | null, assignee?: { id: string; name: string | null; email: string }) => ({
  id: LEAD_ID,
  assigneeUserId,
  assignee: assignee ?? null,
});

describe('LeadAssigneeSelect', () => {
  it('assigns a member in place, showing the name at once', async () => {
    const user = userEvent.setup();
    wrap(<LeadAssigneeSelect lead={lead(null)} organizationId={ORG_ID} canEdit />);

    const trigger = screen.getByRole('combobox', { name: '担当者を変更（現在：担当未定）' });
    await user.click(trigger);
    await user.click(await screen.findByRole('option', { name: '佐藤 花子' }));

    await waitFor(() =>
      expect(state.assign).toHaveBeenCalledWith({
        id: LEAD_ID,
        organizationId: ORG_ID,
        assigneeUserId: SATO,
      })
    );
    expect(screen.getByRole('combobox', { name: '担当者を変更（現在：佐藤 花子）' })).toBeInTheDocument();
  });

  it('unassigns with 担当未定', async () => {
    const user = userEvent.setup();
    wrap(<LeadAssigneeSelect lead={lead(SUZUKI)} organizationId={ORG_ID} canEdit />);

    await user.click(screen.getByRole('combobox', { name: /現在：suzuki@example.com/ }));
    await user.click(await screen.findByRole('option', { name: '担当未定' }));

    await waitFor(() =>
      expect(state.assign).toHaveBeenCalledWith({
        id: LEAD_ID,
        organizationId: ORG_ID,
        assigneeUserId: null,
      })
    );
  });

  it('goes back to the saved assignee when saving fails', async () => {
    let fail: (error: Error) => void = () => {};
    state.assign.mockImplementation(
      () =>
        new Promise((_, reject) => {
          fail = reject;
        })
    );
    const user = userEvent.setup();
    wrap(<LeadAssigneeSelect lead={lead(SATO)} organizationId={ORG_ID} canEdit />);

    await user.click(screen.getByRole('combobox', { name: /現在：佐藤 花子/ }));
    await user.click(await screen.findByRole('option', { name: 'suzuki@example.com' }));
    expect(screen.getByRole('combobox', { name: /現在：suzuki@example.com/ })).toBeInTheDocument();

    fail(new Error('boom'));
    expect(await screen.findByRole('combobox', { name: /現在：佐藤 花子/ })).toBeInTheDocument();
  });

  it('shows read-only roles the name only', () => {
    wrap(<LeadAssigneeSelect lead={lead(SATO)} organizationId={ORG_ID} canEdit={false} />);
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByTestId('lead-assignee')).toHaveTextContent('佐藤 花子');
  });

  it('shows 担当未定 to read-only roles when nobody is assigned', () => {
    wrap(<LeadAssigneeSelect lead={lead(null)} organizationId={ORG_ID} canEdit={false} />);
    expect(screen.getByTestId('lead-assignee')).toHaveTextContent('担当未定');
  });

  it('keeps showing a former member who is still on the lead', () => {
    wrap(
      <LeadAssigneeSelect
        lead={lead(FORMER, { id: FORMER, name: '前任 一郎', email: 'former@example.com' })}
        organizationId={ORG_ID}
        canEdit
      />
    );
    expect(screen.getByRole('combobox', { name: /現在：前任 一郎/ })).toBeInTheDocument();
  });
});

describe('LeadIntakeSettings', () => {
  it('lets owners and admins choose the intake members and save them', async () => {
    const user = userEvent.setup();
    wrap(<LeadIntakeSettings organizationId={ORG_ID} />);

    const save = screen.getByRole('button', { name: '窓口を保存' });
    expect(save).toBeDisabled();
    expect(screen.getByText('窓口は未設定です（これまでどおりの宛先に届きます）')).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: /佐藤 花子/ }));
    expect(save).toBeEnabled();
    await user.click(save);
    expect(state.setIntake).toHaveBeenCalledWith({ organizationId: ORG_ID, userIds: [SATO] });
  });

  it('shows other members who the intake is, without controls', () => {
    state.intake = { userIds: [SATO], canEdit: false };
    wrap(<LeadIntakeSettings organizationId={ORG_ID} />);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '窓口を保存' })).not.toBeInTheDocument();
    expect(screen.getByText('佐藤 花子')).toBeInTheDocument();
    expect(screen.getByText('窓口はオーナーまたは管理者が変更できます。')).toBeInTheDocument();
  });
});
