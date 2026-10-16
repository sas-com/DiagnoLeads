/**
 * The lead page /leads/[leadId] (Refs #107, #108, #109): header, tabs, cards edited in place,
 * the diagnosis, permissions. Real next-intl messages and UI components; the lead hooks and
 * tRPC are mocked over a small store.
 */
import { LeadDetailView } from '@/components/features/leads/detail/lead-detail-view';
import type { Lead } from '@/lib/db/schema';
import messages from '@/locales/ja/common.json';
import { act, configure, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ComponentProps } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

configure({ asyncUtilTimeout: 5000 });

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const LEAD_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_ORG_LEAD_ID = '99999999-9999-4999-8999-999999999999';
const SUBMISSION_ID = '44444444-4444-4444-8444-444444444444';
const HEARING_ID = '66666666-6666-4666-8666-666666666666';

const makeLead = (overrides: Partial<Lead> = {}) =>
  ({
    id: LEAD_ID,
    organizationId: ORG_ID,
    email: 'lead@example.com',
    name: 'Taro Example',
    company: 'Example Works',
    phone: null,
    status: 'new',
    score: 70,
    source: 'website',
    responses: {
      axMigration: {
        urgency: 'high',
        platform: 'as400',
        challenges: ['people'],
        department: null,
        difficulty: 'low',
        sqlSignals: true,
        diagnosedAt: '2026-10-16T01:30:00.000Z',
        mqlCandidate: true,
        needsHearing: false,
        submissionId: SUBMISSION_ID,
        primaryChallenge: 'people',
        consultationRequested: true,
      },
    },
    customFields: {},
    inflowSource: 'lp_organic',
    conversionPoint: 'consultation',
    dealPhase: null,
    targetSystem: 'as400',
    lostReason: null,
    referrerName: null,
    agencyName: null,
    acquisitionCost: null,
    dealPhaseReachedAt: {},
    mqlQualifiedAt: null,
    sqlDecision: null,
    sqlDecidedAt: null,
    hasNegotiated: false,
    tags: [],
    createdAt: new Date('2026-10-16T01:30:00Z'),
    updatedAt: new Date('2026-10-16T01:30:00Z'),
    ...overrides,
  }) as unknown as Lead;

const store = vi.hoisted(() => {
  let leads: unknown[] = [];
  const listeners = new Set<() => void>();
  return {
    get: () => leads,
    set: (next: unknown[]) => {
      leads = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    access: { canCreate: true, canEdit: true, canDelete: true },
    updateMutate: vi.fn(),
    deleteMutate: vi.fn(),
    push: vi.fn(),
  };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: store.push, replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => `/ja/leads/${LEAD_ID}`,
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/hooks/use-organization', () => ({
  useOrganization: () => ({ organizationId: ORG_ID, isLoading: false }),
}));

vi.mock('@/hooks/use-leads', () => ({
  useLeadAccess: () => store.access,
  useUpdateLead: () => ({ mutateAsync: store.updateMutate, isPending: false }),
  useDeleteLead: () => ({ mutateAsync: store.deleteMutate, isPending: false }),
}));

vi.mock('@/lib/trpc/client', async () => {
  const { useSyncExternalStore } = await import('react');
  return {
    trpc: {
      useUtils: () => ({}),
      useContext: () => ({}),
      leads: {
        get: {
          useQuery: (input: { id: string }, options?: { enabled?: boolean }) => {
            const leads = useSyncExternalStore(store.subscribe, store.get) as Lead[];
            if (!options?.enabled) return { data: undefined, isLoading: true, isError: false };
            const lead = leads.find((item) => item.id === input.id);
            if (!lead) {
              return {
                data: undefined,
                isLoading: false,
                isError: true,
                error: { data: { code: 'NOT_FOUND' } },
                refetch: vi.fn(),
              };
            }
            return { data: lead, isLoading: false, isError: false };
          },
        },
      },
      leadHearings: {
        listByLead: {
          useQuery: () => ({
            data: {
              items: [
                {
                  id: HEARING_ID,
                  heldOn: '2026-10-15',
                  dealRating: 'a',
                  missingCount: 2,
                  unconfirmedCount: 0,
                },
              ],
              canEdit: true,
            },
            isLoading: false,
            isError: false,
          }),
        },
        summary: {
          useQuery: () => ({
            data: {
              summary: {
                unconfirmed: [{ key: 'itemA', label: 'Item A', sectionId: 's1' }],
                next: [{ key: 'itemB', label: 'Item B', sectionId: 's1' }],
                missing: [],
              },
            },
            isLoading: false,
          }),
        },
      },
      leadActivity: {
        list: {
          useQuery: (input: { types?: string[] }) => ({
            data: {
              items: [
                {
                  id: `diagnosis:${SUBMISSION_ID}`,
                  kind: 'diagnosis_submitted',
                  at: '2026-10-16T01:30:00.000Z',
                  actor: null,
                  submissionId: SUBMISSION_ID,
                  verified: true,
                  continuation: false,
                  summary: {
                    diagnosticKey: 'ax-migration',
                    platform: 'as400',
                    difficulty: 'low',
                    urgency: 'high',
                    primaryChallenge: 'people',
                    needsHearing: false,
                    detailsAnswered: false,
                  },
                },
                ...(input.types
                  ? []
                  : [
                      {
                        id: 'created',
                        kind: 'lead_created',
                        at: '2026-10-16T01:30:00.000Z',
                        actor: null,
                        source: 'web_diagnosis',
                      },
                    ]),
              ],
              nextCursor: null,
            },
            isLoading: false,
            isError: false,
          }),
        },
        submissionAnswers: {
          useQuery: () => ({
            data: {
              answers: [
                {
                  questionId: 'platform',
                  question: { ja: '移行したいシステム', en: 'System' },
                  detail: false,
                  values: [{ value: 'as400', label: { ja: 'AS/400（IBM i）', en: 'AS/400' } }],
                },
              ],
            },
            isLoading: false,
            isError: false,
          }),
        },
      },
    },
  };
});

// Cards with their own queries; the page's "ヒアリングを記録" opens the hearing card's dialog
vi.mock('@/components/features/lead-hearings/lead-hearings-card', () => ({
  LeadHearingsCard: ({ recordOpen }: { recordOpen?: boolean }) => (
    <p>{recordOpen ? 'record dialog open' : 'hearing list'}</p>
  ),
}));
vi.mock('@/components/features/lead-activity/lead-activity-card', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/features/lead-activity/lead-activity-card')>()),
  LeadActivityCard: () => <p>activity timeline</p>,
}));

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

beforeEach(() => {
  window.history.replaceState(null, '', `/ja/leads/${LEAD_ID}`);
  store.set([makeLead()]);
  store.access = { canCreate: true, canEdit: true, canDelete: true };
  store.updateMutate.mockReset();
  store.deleteMutate.mockReset();
  store.push.mockReset();
  store.updateMutate.mockImplementation(async (input: { id: string } & Partial<Lead>) => {
    const { id, organizationId: _org, ...changes } = input as { id: string; organizationId: string };
    store.set((store.get() as Lead[]).map((lead) => (lead.id === id ? { ...lead, ...changes } : lead)));
  });
});

const renderPage = (props: Partial<ComponentProps<typeof LeadDetailView>> = {}) =>
  render(
    <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
      <LeadDetailView leadId={LEAD_ID} {...props} />
    </NextIntlClientProvider>
  );

const card = (name: string) => screen.getByRole('region', { name });

describe('LeadDetailView header', () => {
  it('shows the name, company, status, deal phase and score, with a link back to the list', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Taro Example' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 }).nextElementSibling).toHaveTextContent(
      'Example Works'
    );
    expect(screen.getByRole('combobox', { name: /ステータスを変更（現在：新規）/ })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /商談フェーズを変更（現在：フェーズ未設定）/ })).toBeInTheDocument();
    expect(screen.getByTestId('lead-score')).toHaveTextContent('スコア 70');
    expect(screen.getByRole('link', { name: 'リード一覧' })).toHaveAttribute('href', '/ja/leads');
  });

  it('changes the status from the header, sending only the status', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('combobox', { name: /ステータスを変更/ }));
    await user.click(await screen.findByRole('option', { name: '商談中' }));

    await waitFor(() =>
      expect(store.updateMutate).toHaveBeenCalledWith({
        id: LEAD_ID,
        organizationId: ORG_ID,
        status: 'negotiating',
      })
    );
    expect(screen.getByRole('combobox', { name: /ステータスを変更（現在：商談中）/ })).toBeInTheDocument();
  });

  it('shows the new deal phase at once and goes back to the saved one when saving fails', async () => {
    let fail: (error: Error) => void = () => {};
    store.updateMutate.mockImplementation(
      () =>
        new Promise((_, reject) => {
          fail = reject;
        })
    );
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('combobox', { name: /商談フェーズを変更/ }));
    await user.click(await screen.findByRole('option', { name: '提案' }));

    // Optimistic
    expect(screen.getByRole('combobox', { name: /商談フェーズを変更（現在：提案）/ })).toBeInTheDocument();
    expect(store.updateMutate).toHaveBeenCalledWith({
      id: LEAD_ID,
      organizationId: ORG_ID,
      dealPhase: 'proposal',
    });
    await act(async () => fail(new Error('boom')));
    // Rolled back
    expect(
      await screen.findByRole('combobox', { name: /商談フェーズを変更（現在：フェーズ未設定）/ })
    ).toBeInTheDocument();
  });

  it('opens the contact card from the more-actions menu and deletes after confirming', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'その他の操作' }));
    await user.click(await screen.findByRole('menuitem', { name: '編集' }));
    expect(await within(card('連絡先')).findByRole('textbox', { name: '名前' })).toHaveFocus();

    await user.click(within(card('連絡先')).getByRole('button', { name: 'キャンセル' }));
    await user.click(screen.getByRole('button', { name: 'その他の操作' }));
    await user.click(await screen.findByRole('menuitem', { name: '削除' }));
    const confirm = await screen.findByRole('alertdialog');
    await user.click(within(confirm).getByRole('button', { name: '削除' }));
    await waitFor(() =>
      expect(store.deleteMutate).toHaveBeenCalledWith({ id: LEAD_ID, organizationId: ORG_ID })
    );
    expect(store.push).toHaveBeenCalledWith('/ja/leads');
  });

  it('records a hearing with the hearing card’s own dialog', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'ヒアリングを記録' }));
    expect(screen.getByRole('tab', { name: 'ヒアリング' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('record dialog open')).toBeInTheDocument();
  });

  it('opens recording right away from the side panel’s link (?record=1)', () => {
    renderPage({ initialTab: 'hearings', initialRecord: true });
    expect(screen.getByText('record dialog open')).toBeInTheDocument();
  });
});

describe('LeadDetailView tabs', () => {
  it('keeps the tab in the URL', async () => {
    const user = userEvent.setup();
    renderPage();
    expect(screen.getByRole('tab', { name: '概要' })).toHaveAttribute('aria-selected', 'true');

    await user.click(screen.getByRole('tab', { name: '活動履歴' }));
    expect(screen.getByText('activity timeline')).toBeInTheDocument();
    expect(window.location.search).toBe('?tab=activity');

    await user.click(screen.getByRole('tab', { name: '概要' }));
    expect(window.location.search).toBe('');
  });

  it('opens the tab from the URL and drops one-off parameters', () => {
    window.history.replaceState(null, '', `/ja/leads/${LEAD_ID}?tab=activity&edit=contact`);
    renderPage({ initialTab: 'activity' });
    expect(screen.getByRole('tab', { name: '活動履歴' })).toHaveAttribute('aria-selected', 'true');
    expect(window.location.search).toBe('?tab=activity');
  });

  it('shows the diagnosis answers by question and option labels', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('tab', { name: '診断回答' }));
    expect(await screen.findByText('移行したいシステム')).toBeInTheDocument();
    expect(screen.getAllByText('AS/400（IBM i）').length).toBeGreaterThan(0);
    expect(screen.queryByText(/[{}]/)).not.toBeInTheDocument();
  });
});

describe('LeadDetailView overview', () => {
  it('starts with the latest hearing and what to confirm next', () => {
    renderPage();
    const hearing = screen.getByRole('region', { name: '商談のまとめ' });
    expect(within(hearing).getByText(/最新のヒアリング/)).toBeInTheDocument();
    expect(within(hearing).getByTestId('lead-next-steps')).toHaveTextContent('Item A');
    expect(within(hearing).getByRole('link', { name: 'まとめを見る' })).toHaveAttribute(
      'href',
      `/ja/leads/${LEAD_ID}/hearings/${HEARING_ID}?view=summary`
    );
  });

  it('shows the diagnosis readably, with a link to its answers instead of the id', async () => {
    const user = userEvent.setup();
    renderPage();
    const diagnosis = screen.getByTestId('lead-diagnosis-card');
    expect(within(diagnosis).getByText('AS/400（IBM i）')).toBeInTheDocument();
    expect(within(diagnosis).getByText('相談の申込みあり')).toBeInTheDocument();
    expect(within(diagnosis).getByText('適合', { selector: '[title]' })).toBeInTheDocument();
    expect(within(diagnosis).getByText('ヒト：人に依存した基幹システム')).toBeInTheDocument();
    expect(diagnosis).not.toHaveTextContent(SUBMISSION_ID);

    await user.click(within(diagnosis).getByRole('button', { name: /回答を見る/ }));
    expect(screen.getByRole('tab', { name: '診断回答' })).toHaveAttribute('aria-selected', 'true');
  });

  it('shows only fields with a value and collapses the empty ones into one line', async () => {
    const user = userEvent.setup();
    renderPage();
    const contact = card('連絡先');
    expect(within(contact).getByText('lead@example.com')).toBeInTheDocument();
    expect(within(contact).queryByText('未設定')).not.toBeInTheDocument();
    // name, company, email set; phone empty
    const line = within(contact).getByRole('button', { name: /未設定 1 件/ });
    expect(line).toHaveAttribute('aria-expanded', 'false');
    await user.click(line);
    expect(within(contact).getByRole('list', { name: '未設定の項目' })).toHaveTextContent('電話番号');
  });

  it('opens the card at the first empty field from 入力する', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(within(card('連絡先')).getByRole('button', { name: '入力する' }));
    expect(await within(card('連絡先')).findByRole('textbox', { name: '電話番号' })).toHaveFocus();
  });

  it('shows the lost / on-hold reason only for a lost lead', () => {
    const { unmount } = renderPage();
    expect(screen.queryByText('失注・保留理由')).not.toBeInTheDocument();
    unmount();

    store.set([makeLead({ status: 'lost', lostReason: 'budget' })]);
    renderPage();
    expect(within(card('営業パイプライン')).getByText('失注・保留理由')).toBeInTheDocument();
    expect(within(card('営業パイプライン')).getByText('予算')).toBeInTheDocument();
  });

  it('opens the card and field named in the URL', async () => {
    store.set([makeLead({ status: 'lost' })]);
    renderPage({ initialEdit: 'pipeline', initialField: 'lostReason' });
    expect(
      await within(card('営業パイプライン')).findByRole('combobox', { name: '失注・保留理由' })
    ).toHaveFocus();
  });
});

describe('LeadDetailView editing in place', () => {
  it('cancels without saving and gives the focus back to 編集', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: '連絡先を編集' }));
    const company = within(card('連絡先')).getByRole('textbox', { name: '会社名' });
    await user.clear(company);
    await user.type(company, 'Changed Co');
    await user.click(within(card('連絡先')).getByRole('button', { name: 'キャンセル' }));

    expect(store.updateMutate).not.toHaveBeenCalled();
    expect(within(card('連絡先')).getByText('Example Works')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '連絡先を編集' })).toHaveFocus();
  });

  it('saves only the changed fields', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: '連絡先を編集' }));
    const company = within(card('連絡先')).getByRole('textbox', { name: '会社名' });
    await user.clear(company);
    await user.type(company, 'Changed Co');
    await user.click(within(card('連絡先')).getByRole('button', { name: '保存' }));

    await waitFor(() =>
      expect(store.updateMutate).toHaveBeenCalledWith({
        company: 'Changed Co',
        id: LEAD_ID,
        organizationId: ORG_ID,
      })
    );
    expect(await within(card('連絡先')).findByText('Changed Co')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '連絡先を編集' })).toHaveFocus();
  });

  it('saves with Enter and cancels with Esc', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: '連絡先を編集' }));
    await user.type(within(card('連絡先')).getByRole('textbox', { name: '電話番号' }), '03-0000-0000{Enter}');
    await waitFor(() =>
      expect(store.updateMutate).toHaveBeenCalledWith({
        phone: '03-0000-0000',
        id: LEAD_ID,
        organizationId: ORG_ID,
      })
    );

    await user.click(await screen.findByRole('button', { name: '連絡先を編集' }));
    await user.type(within(card('連絡先')).getByRole('textbox', { name: '会社名' }), 'x');
    await user.keyboard('{Escape}');
    expect(within(card('連絡先')).queryByRole('textbox')).not.toBeInTheDocument();
    expect(store.updateMutate).toHaveBeenCalledTimes(1);
  });

  it('shows validation errors under the input and does not save', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: '連絡先を編集' }));
    const email = within(card('連絡先')).getByRole('textbox', { name: /メールアドレス/ });
    await user.clear(email);
    await user.type(email, 'not-an-email');
    await user.click(within(card('連絡先')).getByRole('button', { name: '保存' }));

    expect(await within(card('連絡先')).findByText('有効なメールアドレスを入力してください')).toBeInTheDocument();
    expect(email).toHaveAttribute('aria-invalid', 'true');
    expect(store.updateMutate).not.toHaveBeenCalled();
  });

  it('edits the score by hand within 0-100', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: '営業パイプラインを編集' }));
    const score = within(card('営業パイプライン')).getByRole('spinbutton', { name: /スコア/ });
    await user.clear(score);
    await user.type(score, '150');
    await user.click(within(card('営業パイプライン')).getByRole('button', { name: '保存' }));
    expect(await within(card('営業パイプライン')).findByText('最大値は100です')).toBeInTheDocument();
    expect(store.updateMutate).not.toHaveBeenCalled();

    await user.clear(score);
    await user.type(score, '85');
    await user.click(within(card('営業パイプライン')).getByRole('button', { name: '保存' }));
    await waitFor(() =>
      expect(store.updateMutate).toHaveBeenCalledWith({ score: 85, id: LEAD_ID, organizationId: ORG_ID })
    );
    expect(await screen.findByTestId('lead-score')).toHaveTextContent('スコア 85');
  });

  it('asks before dropping unsaved changes when another card is opened', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: '連絡先を編集' }));
    await user.type(within(card('連絡先')).getByRole('textbox', { name: '会社名' }), ' X');
    await user.click(screen.getByRole('button', { name: '流入の情報を編集' }));

    let ask = await screen.findByRole('alertdialog', { name: '保存していない変更があります' });
    await user.click(within(ask).getByRole('button', { name: '編集を続ける' }));
    expect(within(card('連絡先')).getByRole('textbox', { name: '会社名' })).toHaveValue('Example Works X');

    await user.click(screen.getByRole('button', { name: '流入の情報を編集' }));
    ask = await screen.findByRole('alertdialog');
    await user.click(within(ask).getByRole('button', { name: '変更を破棄' }));
    await waitFor(() => expect(within(card('連絡先')).queryByRole('textbox')).not.toBeInTheDocument());
    expect(within(card('流入の情報')).getByRole('combobox', { name: '流入元' })).toBeInTheDocument();
    expect(store.updateMutate).not.toHaveBeenCalled();
  });

  it('asks before leaving the page with unsaved changes', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: '連絡先を編集' }));
    await user.type(within(card('連絡先')).getByRole('textbox', { name: '会社名' }), ' X');
    await user.click(screen.getByRole('link', { name: 'リード一覧' }));

    const ask = await screen.findByRole('alertdialog');
    expect(store.push).not.toHaveBeenCalled();
    await user.click(within(ask).getByRole('button', { name: '変更を破棄' }));
    await waitFor(() => expect(store.push).toHaveBeenCalledWith('/ja/leads'));
  });
});

describe('LeadDetailView permissions', () => {
  it('gives read-only roles no edit controls', () => {
    store.access = { canCreate: false, canEdit: false, canDelete: false };
    renderPage();
    expect(screen.queryByRole('button', { name: /を編集$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'ヒアリングを記録' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'その他の操作' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '入力する' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    // Status and phase as plain badges
    expect(screen.getByText('新規')).toBeInTheDocument();
  });

  it('shows "not found" for a lead of another organization or a broken id', () => {
    const { unmount } = renderPage({ leadId: OTHER_ORG_LEAD_ID });
    expect(screen.getByText('リードが見つかりません')).toBeInTheDocument();
    expect(screen.queryByText('Taro Example')).not.toBeInTheDocument();
    unmount();

    renderPage({ leadId: 'not-a-lead' });
    expect(screen.getByText('リードが見つかりません')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'リード一覧へ戻る' })).toHaveAttribute('href', '/ja/leads');
  });
});
