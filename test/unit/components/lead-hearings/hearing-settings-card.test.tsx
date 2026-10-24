/**
 * The organization's hearing fields (#98) in the settings: what is saved (asked, required and
 * order), a field not asked is not required either, back to the defaults, and members who cannot
 * change them.
 */
import { HearingSettingsCard } from '@/components/features/lead-hearings/hearing-settings-card';
import messages from '@/locales/ja/common.json';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  result: {} as Record<string, unknown>,
  mutate: vi.fn(),
}));

vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    useUtils: () => ({ leadHearings: { catalogSettings: { invalidate: vi.fn() } } }),
    leadHearings: {
      catalogSettings: { useQuery: () => mocks.result },
      updateCatalogSettings: { useMutation: () => ({ mutate: mocks.mutate, isPending: false }) },
    },
  },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';

const settings = (values: Record<string, unknown> = {}) => ({
  hidden: [],
  required: null,
  order: {},
  customFields: [],
  version: 0,
  ...values,
});

const renderCard = () =>
  render(
    <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
      <HearingSettingsCard organizationId={ORG_ID} />
    </NextIntlClientProvider>
  );

const saved = () => mocks.mutate.mock.calls.at(-1)?.[0].settings;

// The card lists every catalog field with two checkboxes and two buttons. A query over the whole
// card computes the name of ~130 buttons (getByLabelText reads the labels of every control), which
// took seconds per query on a loaded machine and timed the tests out (#573). So controls are
// looked up inside their row, their section or the own-field editor.
const row = (key: string) => within(screen.getByTestId(`hearing-setting-${key}`));
const section = (name: string) => within(screen.getByRole('group', { name }));
const ownFields = () => within(screen.getByRole('region', { name: '独自の項目' }));
// The save and reset buttons below the lists, found by their text for the same reason. The
// read-only test looks for them the same way, from the same texts, so the tests that press them
// and the one that expects none cannot drift apart
type FormButtonText = '保存' | '初期の設定に戻す';
const formButton = (text: FormButtonText) => screen.getByText(text, { selector: 'button' });
const queryFormButton = (text: FormButtonText) => screen.queryByText(text, { selector: 'button' });
const meetingRows = () =>
  section('実施情報')
    .getAllByRole('listitem')
    .map((item) => item.getAttribute('data-testid'));

// The checkboxes (Radix) measure themselves
beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

beforeEach(() => {
  mocks.mutate.mockReset();
  mocks.result = { data: { settings: settings(), canEdit: true }, isError: false };
});

describe('HearingSettingsCard', () => {
  it('saves a field not asked, which is then not required either', () => {
    renderCard();
    const required = row('targetSystem').getByRole('checkbox', {
      name: '対象システム を必須にする',
    });
    expect(required).toBeChecked();
    fireEvent.click(row('targetSystem').getByRole('checkbox', { name: '対象システム を聞く' }));
    expect(required).not.toBeChecked();
    expect(required).toBeDisabled();

    fireEvent.click(row('budgetStatus').getByRole('checkbox', { name: '予算の状態 を必須にする' }));
    fireEvent.click(formButton('保存'));
    expect(saved().hidden).toEqual(['targetSystem']);
    expect(saved().required).toContain('budgetStatus');
    expect(saved().required).not.toContain('targetSystem');
  });

  it('saves only what differs from the base, so later base changes still apply', () => {
    renderCard();
    fireEvent.click(row('machineModel').getByRole('checkbox', { name: '機種・バージョン を聞く' }));
    fireEvent.click(formButton('保存'));
    expect(saved()).toEqual({
      hidden: ['machineModel'],
      required: null,
      order: {},
      customFields: [],
    });
  });

  it('moves a field within its section', () => {
    renderCard();
    expect(meetingRows()[0]).toBe('hearing-setting-meetingFormat');
    fireEvent.click(
      row('attendeeRoles').getByRole('button', { name: '先方の出席者の立場 を上へ' })
    );
    expect(meetingRows().slice(0, 2)).toEqual([
      'hearing-setting-attendeeRoles',
      'hearing-setting-meetingFormat',
    ]);
    fireEvent.click(formButton('保存'));
    expect(saved().order).toEqual({
      meeting: ['attendeeRoles', 'meetingFormat', 'decisionMakerPresent'],
    });
  });

  it('starts from the saved settings and goes back to the defaults', () => {
    mocks.result = {
      data: {
        settings: settings({ hidden: ['machineModel'], order: { meeting: ['decisionMakerPresent'] } }),
        canEdit: true,
      },
      isError: false,
    };
    renderCard();
    expect(
      row('machineModel').getByRole('checkbox', { name: '機種・バージョン を聞く' })
    ).not.toBeChecked();
    expect(meetingRows()[0]).toBe('hearing-setting-decisionMakerPresent');

    fireEvent.click(formButton('初期の設定に戻す'));
    expect(
      row('machineModel').getByRole('checkbox', { name: '機種・バージョン を聞く' })
    ).toBeChecked();
    expect(meetingRows()[0]).toBe('hearing-setting-meetingFormat');
  });

  it('adds an own choice field, asked and required like the others', () => {
    renderCard();
    fireEvent.click(ownFields().getByRole('button', { name: '独自の項目を追加' }));
    fireEvent.change(ownFields().getByLabelText('項目名'), { target: { value: '導入時期の希望' } });
    fireEvent.change(ownFields().getByLabelText('答え方'), { target: { value: 'single' } });
    fireEvent.change(ownFields().getByLabelText('導入時期の希望 の選択肢 1'), {
      target: { value: '今期' },
    });
    fireEvent.click(ownFields().getByRole('button', { name: '選択肢を追加' }));
    // A choice left empty is dropped on save. A new field goes to the requirements section
    fireEvent.click(section('要件').getByRole('checkbox', { name: '導入時期の希望 を必須にする' }));
    fireEvent.click(formButton('保存'));

    const [field] = saved().customFields;
    expect(field).toMatchObject({
      label: '導入時期の希望',
      type: 'single',
      section: 'requirements',
      options: [{ label: '今期' }],
    });
    expect(field.options).toHaveLength(1);
    expect(saved().required).toContain(`custom:${field.id}`);
  });

  it('refuses an own field without a name', () => {
    renderCard();
    fireEvent.click(ownFields().getByRole('button', { name: '独自の項目を追加' }));
    fireEvent.click(formButton('保存'));
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it('removes a saved own field from every list, and keeps its type fixed', () => {
    const own = {
      id: 'note0001',
      label: '社内の呼び名',
      type: 'text',
      section: 'customer',
      options: [],
    };
    const archived = { ...own, id: 'gone0001', label: '昔の項目', archived: true };
    mocks.result = {
      data: {
        settings: settings({
          customFields: [own, archived],
          hidden: ['custom:gone0001'],
          order: { customer: ['custom:note0001'] },
        }),
        canEdit: true,
      },
      isError: false,
    };
    renderCard();
    expect(screen.getByTestId('hearing-setting-custom:note0001')).toBeInTheDocument();
    // An archived field is not in the lists, only among the removed ones to bring back
    expect(screen.queryByTestId('hearing-setting-custom:gone0001')).not.toBeInTheDocument();
    expect(ownFields().getByRole('button', { name: '昔の項目 を戻す' })).toBeInTheDocument();
    expect(ownFields().getByLabelText('答え方')).toBeDisabled();

    fireEvent.click(ownFields().getByRole('button', { name: '社内の呼び名 を削除' }));
    fireEvent.click(formButton('保存'));
    expect(saved()).toEqual({
      hidden: ['custom:gone0001'],
      required: null,
      order: {},
      // Both kept archived, so older records still read them
      customFields: [archived, { ...own, archived: true }],
    });
    expect(mocks.mutate.mock.calls.at(-1)?.[0].expectedVersion).toBe(0);
    // A removed field can be brought back
    fireEvent.click(ownFields().getByRole('button', { name: '社内の呼び名 を戻す' }));
    expect(screen.getByTestId('hearing-setting-custom:note0001')).toBeInTheDocument();
  });

  it('lets members only read them', () => {
    mocks.result = { data: { settings: settings(), canEdit: false }, isError: false };
    renderCard();
    expect(
      row('targetSystem').getByRole('checkbox', { name: '対象システム を聞く' })
    ).toBeDisabled();
    expect(queryFormButton('保存')).not.toBeInTheDocument();
    expect(queryFormButton('初期の設定に戻す')).not.toBeInTheDocument();
    expect(screen.getByText('変更できるのはオーナーと管理者です。')).toBeInTheDocument();
  });
});
