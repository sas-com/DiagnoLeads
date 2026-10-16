/**
 * Hearing editor inputs of #130 (real next-intl messages, tRPC mocked): the "other" note, the
 * date and month pickers inside the editor and the jump to a missing field. Option and field
 * labels are read from the catalog and the locale files, not written here.
 */
import { LeadHearingEditor } from '@/components/features/lead-hearings/lead-hearing-editor';
import { getHearingField } from '@/lib/features/lead-hearings/catalog';
import { hearingModeStorageKey } from '@/lib/features/lead-hearings/meeting-mode';
import messages from '@/locales/ja/common.json';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const LEAD_ID = '770e8400-e29b-41d4-a716-446655440000';
const HEARING_ID = '880e8400-e29b-41d4-a716-446655440000';
const UPDATED_AT = new Date('2026-10-15T01:00:00Z');
const USER_ID = 'user-1';
const MODE_KEY = hearingModeStorageKey(USER_ID);

interface MutationOptions {
  onSuccess: (result: unknown) => void;
  onError: (error: unknown) => void;
}

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  refetch: vi.fn(),
  data: undefined as unknown,
  error: null as unknown,
  update: undefined as undefined | MutationOptions,
  setData: vi.fn(),
  invalidateGet: vi.fn(),
  invalidateList: vi.fn(),
  invalidateSummary: vi.fn(),
  summary: undefined as unknown,
}));

vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    useUtils: () => ({
      leadHearings: {
        get: { invalidate: mocks.invalidateGet, setData: mocks.setData },
        listByLead: { invalidate: mocks.invalidateList },
        summary: { invalidate: mocks.invalidateSummary },
      },
    }),
    leadHearings: {
      get: {
        useQuery: () => ({
          data: mocks.error ? undefined : mocks.data,
          isError: Boolean(mocks.error),
          error: mocks.error,
          refetch: mocks.refetch,
        }),
      },
      summary: {
        useQuery: () => ({
          data: mocks.summary ? { summary: mocks.summary } : undefined,
          isError: false,
        }),
      },
      update: {
        useMutation: (options: MutationOptions) => {
          mocks.update = options;
          return { mutate: mocks.mutate, isPending: false };
        },
      },
    },
    leads: {
      get: {
        useQuery: () => ({
          data: { id: LEAD_ID, name: 'Lead A', company: 'Company A', email: 'a@example.com' },
        }),
      },
    },
  },
}));
vi.mock('@/lib/auth/client', () => ({
  useSession: () => ({ data: { user: { id: USER_ID } }, isPending: false }),
}));
vi.mock('@/hooks/use-organization', () => ({
  useOrganization: () => ({ organizationId: ORG_ID }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

function hearing(overrides: Record<string, unknown> = {}) {
  return {
    id: HEARING_ID,
    leadId: LEAD_ID,
    heldOn: '2026-10-15',
    catalogVersion: 1,
    fields: {
      targetSystem: { value: 'as400', status: 'not_yet', source: 'prefilled' },
      attendeeRoles: { value: ['executive'], status: 'not_yet', source: 'prefilled' },
    },
    droppedKeys: [],
    prefill: {
      submissionId: '990e8400-e29b-41d4-a716-446655440000',
      diagnosticKey: 'ax-migration',
      diagnosticVersion: 1,
      submittedAt: '2026-10-01T00:00:00Z',
      verified: false,
      answers: { platform: 'as400', role: 'executive' },
      challenges: null,
      hints: { targetSystem: ['platform'], attendeeRoles: ['role'] },
    },
    updatedAt: UPDATED_AT,
    canEdit: true,
    ...overrides,
  };
}

// A new element each time, so rerender() really renders again
const editor = (initialView?: 'record' | 'summary') => (
  <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
    <LeadHearingEditor leadId={LEAD_ID} hearingId={HEARING_ID} initialView={initialView} />
  </NextIntlClientProvider>
);

const savedFields = () => mocks.mutate.mock.calls[0][0].fields;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.data = hearing();
  mocks.error = null;
  mocks.summary = undefined;
  window.localStorage.clear();
});
const fieldRow = (key: string) => screen.getByTestId(`hearing-field-${key}`);
const lh = messages.leadHearings;
const fill = (template: string, values: Record<string, string | number>) =>
  Object.entries(values).reduce((text, [k, v]) => text.replace(`{${k}}`, String(v)), template);
const fieldLabel = (key: string) => (lh.fields as Record<string, string>)[key];

/** Japanese label of a catalog option (locale key or Web diagnosis label) */
function optionLabel(key: string, value: string): string {
  const field = getHearingField(key);
  if (!field || (field.type !== 'single' && field.type !== 'multiple')) throw new Error(key);
  const option = field.options.find((o) => o.value === value);
  if (!option) throw new Error(value);
  if (option.label) return option.label.ja;
  const path = (option.labelKey ?? '').split('.');
  return path.reduce<unknown>(
    (node, part) => (node as Record<string, unknown>)[part],
    messages
  ) as string;
}
const noteBox = (key: string) =>
  within(fieldRow(key)).queryByRole('textbox', {
    name: fill(lh.editor.otherNoteOf, { field: fieldLabel(key) }),
  });

describe('"other" note (detail mode)', () => {
  beforeEach(() => window.localStorage.setItem(MODE_KEY, 'detail'));

  it('shows the note under a multiple choice while "other" is checked and saves it', async () => {
    const user = userEvent.setup();
    render(editor());

    expect(noteBox('attendeeRoles')).not.toBeInTheDocument();
    const other = within(fieldRow('attendeeRoles')).getByRole('checkbox', {
      name: optionLabel('attendeeRoles', 'other'),
    });
    await user.click(other);
    const box = noteBox('attendeeRoles');
    expect(box).toBeInTheDocument();
    await user.type(box as HTMLElement, ' note A ');
    await user.click(screen.getByRole('button', { name: '保存' }));

    expect(savedFields().attendeeRoles).toEqual({
      value: ['executive', 'other'],
      status: 'done',
      source: 'corrected',
      otherNote: 'note A',
    });
  });

  it('hides the note when "other" is unchecked, keeps it for this session, and does not save it', async () => {
    const user = userEvent.setup();
    render(editor());
    const other = within(fieldRow('attendeeRoles')).getByRole('checkbox', {
      name: optionLabel('attendeeRoles', 'other'),
    });

    await user.click(other);
    await user.type(noteBox('attendeeRoles') as HTMLElement, 'note A');
    await user.click(other);
    expect(noteBox('attendeeRoles')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '保存' }));
    expect(savedFields().attendeeRoles.value).toEqual(['executive']);
    expect(savedFields().attendeeRoles).not.toHaveProperty('otherNote');

    // Checked again before leaving: the text is still there
    await user.click(other);
    expect(noteBox('attendeeRoles')).toHaveValue('note A');
  });

  it('reads a stored note, and a stored "other" without a note (older hearings)', async () => {
    const user = userEvent.setup();
    mocks.data = hearing({
      fields: {
        attendeeRoles: { value: ['other'], status: 'done', source: null },
        competitorTypes: {
          value: ['other_integrator'],
          status: 'done',
          source: null,
          otherNote: 'note B',
        },
      },
    });
    render(editor());

    expect(noteBox('attendeeRoles')).toHaveValue('');
    await user.click(screen.getByRole('tab', { name: /要件/ }));
    expect(noteBox('competitorTypes')).toHaveValue('note B');
  });
});

describe('"other" note (meeting mode)', () => {
  beforeEach(() => window.localStorage.setItem(MODE_KEY, 'meeting'));

  it('opens the note under a single choice chip and drops it when another chip is chosen', async () => {
    const user = userEvent.setup();
    mocks.data = hearing({ fields: {} });
    render(editor());
    const chipOf = (value: string) =>
      within(fieldRow('targetSystem')).getByRole('button', {
        name: optionLabel('targetSystem', value),
      });

    await user.click(chipOf('other'));
    await user.type(noteBox('targetSystem') as HTMLElement, 'note C');
    await user.click(screen.getByRole('button', { name: '保存' }));
    expect(mocks.mutate.mock.calls[0][0].fields.targetSystem).toEqual({
      value: 'other',
      status: 'done',
      source: null,
      otherNote: 'note C',
    });
    // The manual save settles (the form shows what was stored) before the next one
    act(() =>
      mocks.update?.onSuccess(
        hearing({ fields: mocks.mutate.mock.calls[0][0].fields, updatedAt: new Date() })
      )
    );

    await user.click(chipOf('as400'));
    expect(noteBox('targetSystem')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '保存' }));
    expect(mocks.mutate.mock.calls[1][0].fields.targetSystem).toEqual({
      value: 'as400',
      status: 'done',
      source: null,
    });
  });
});

describe('dates and months in the editor', () => {
  beforeEach(() => window.localStorage.setItem(MODE_KEY, 'detail'));

  it('saves a typed next meeting date and the meeting date in the stored format', async () => {
    const user = userEvent.setup();
    render(editor());

    const heldOn = screen.getByLabelText(lh.editor.heldOn);
    expect(heldOn).toHaveValue('2026/10/15');
    await user.clear(heldOn);
    await user.type(heldOn, '2026/10/16');

    await user.click(screen.getByRole('tab', { name: /結果/ }));
    await user.type(screen.getByLabelText(fieldLabel('nextMeetingDate')), '2026/11/5');
    await user.click(screen.getByRole('button', { name: '保存' }));

    expect(mocks.mutate.mock.calls[0][0].heldOn).toBe('2026-10-16');
    expect(savedFields().nextMeetingDate).toEqual({
      value: '2026-11-05',
      status: 'done',
      source: null,
    });
  });

  it('clears a stored date from the calendar', async () => {
    const user = userEvent.setup();
    mocks.data = hearing({
      fields: { nextMeetingDate: { value: '2026-11-05', status: 'done', source: null } },
    });
    render(editor());

    await user.click(screen.getByRole('tab', { name: /結果/ }));
    expect(screen.getByLabelText(fieldLabel('nextMeetingDate'))).toHaveValue('2026/11/05');
    await user.click(
      screen.getByRole('button', {
        name: fill(lh.editor.openCalendar, { field: fieldLabel('nextMeetingDate') }),
      })
    );
    await user.click(await screen.findByRole('button', { name: lh.editor.clear }));
    await user.click(screen.getByRole('button', { name: '保存' }));
    expect(savedFields().nextMeetingDate).toEqual({ status: 'done', source: null });
  });

  it('picks a year and month with the month picker', async () => {
    const user = userEvent.setup();
    mocks.data = hearing({
      fields: { earliestRetirement: { value: '2027-03', status: 'done', source: null } },
    });
    render(editor());

    await user.click(screen.getByRole('tab', { name: /現行システム/ }));
    const label = fieldLabel('earliestRetirement');
    await user.click(screen.getByRole('button', { name: `${label}: 2027年3月` }));
    await user.click(await screen.findByRole('button', { name: lh.editor.nextYear }));
    await user.click(screen.getByRole('button', { name: '2028年10月' }));
    expect(screen.getByRole('button', { name: `${label}: 2028年10月` })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '保存' }));
    expect(savedFields().earliestRetirement).toEqual({
      value: '2028-10',
      status: 'done',
      source: null,
    });
  });
});

describe('missing required fields', () => {
  beforeEach(() => window.localStorage.setItem(MODE_KEY, 'detail'));

  it('marks missing required fields and jumps to the first one from the save bar', async () => {
    const user = userEvent.setup();
    mocks.data = hearing({ fields: {} });
    render(editor());

    expect(within(fieldRow('attendeeRoles')).getByText(lh.editor.missingField)).toBeInTheDocument();
    expect(within(fieldRow('meetingFormat')).queryByText(lh.editor.missingField)).toBeNull();

    // Somewhere else first, then back to the first missing field from the save bar
    await user.click(screen.getByRole('tab', { name: /結果/ }));
    await user.click(screen.getByTitle(lh.editor.jumpToMissing));
    expect(screen.getByRole('tab', { name: /実施情報/ })).toHaveAttribute('aria-selected', 'true');
    await waitFor(() =>
      expect(within(fieldRow('attendeeRoles')).getAllByRole('checkbox')[0]).toHaveFocus()
    );
  });

  it('focuses the missing field of an item picked in the warning', async () => {
    const user = userEvent.setup();
    mocks.data = hearing({
      fields: { targetSystem: { value: 'as400', status: 'done', source: null } },
    });
    render(editor());

    await user.click(screen.getByRole('tab', { name: /結果/ }));
    await user.click(screen.getByRole('button', { name: '対象システムと機種' }));
    await waitFor(() => expect(screen.getByLabelText(fieldLabel('machineModel'))).toHaveFocus());
  });
});
