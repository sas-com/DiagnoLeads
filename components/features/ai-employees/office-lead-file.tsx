'use client';

import { type RouterOutputs, trpc } from '@/lib/trpc/client';
import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { type MutableRefObject, type ReactNode, useEffect, useRef, useState } from 'react';
import { CAP, FOCUS, KEY, PANEL } from './office-hud';
import {
  type FileChoice,
  type FileContactChoice,
  fileChoiceOfKey,
  fileChoices,
} from './office-rooms';

export type BoardLead = RouterOutputs['leads']['list']['items'][number];

/** What the keys of a room do; true when the key was used */
export type RoomKeys = (event: { key: string; preventDefault: () => void }) => boolean;

/** The colour of a lead status on the dark board; the word is always shown with it */
export const LEAD_STATUS_COLORS: Record<string, string> = {
  new: '#93c5fd',
  nurturing: '#d8d2c4',
  negotiating: '#86efac',
  won: '#e9cf9a',
  lost: '#bdb7a9',
};

type Outcome =
  | { kind: 'recorded'; contact: FileContactChoice; id: string }
  | { kind: 'undone' }
  | { kind: 'failed' };

/**
 * A customer file opened inside a room of the full-screen office (#1128): the lead, its contact
 * records, and the president's answers that record a contact (called, emailed, no answer) with
 * the lead page's own API, so the work ends inside the office.
 *
 * What the room says about the file comes from the records only. An answer is carried out at
 * once, so it can be undone, and after it the first choice is the way back: the same key pressed
 * once too often neither records twice nor takes the record back.
 */
export function OfficeLeadFile({
  organizationId,
  lead,
  header,
  keysRef,
  onClose,
  onOpenDetail,
}: {
  organizationId: string;
  lead: BoardLead;
  /** Whose room this is: shown over the report, like over the board */
  header: ReactNode;
  /** Filled with the file's key handler while the file is open */
  keysRef: MutableRefObject<RoomKeys | null>;
  onClose: () => void;
  /** The lead's page is opened in the normal view: the office closes */
  onOpenDetail: () => void;
}) {
  const t = useTranslations('aiOffice.immersive.room.file');
  const tLeads = useTranslations('aiOffice.immersive.room.leads');
  const tImmersive = useTranslations('aiOffice.immersive');
  const tStatus = useTranslations('status');
  const tLevels = useTranslations('leadActivity.summary.mqlLevels');
  const tKinds = useTranslations('leadFollowUp.contact.kinds');
  const tLead = useTranslations('leads');
  const format = useFormatter();
  const locale = useLocale();
  const utils = trpc.useUtils();
  const reportRef = useRef<HTMLDivElement>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const contacts = trpc.leadFollowUp.contacts.useQuery({ organizationId, leadId: lead.id });
  const refresh = () => {
    void utils.leadFollowUp.contacts.invalidate({ organizationId, leadId: lead.id });
    void utils.leadActivity.list.invalidate();
    void utils.leadActivity.forDeal.invalidate();
    void utils.leadActivity.myDay.invalidate({ organizationId });
    void utils.analytics.getDashboard.invalidate();
  };
  const record = trpc.leadFollowUp.recordContact.useMutation({
    onSuccess: (saved, input) => {
      setOutcome({ kind: 'recorded', contact: input.kind as FileContactChoice, id: saved.id });
      refresh();
    },
    onError: () => setOutcome({ kind: 'failed' }),
  });
  const remove = trpc.leadFollowUp.deleteContact.useMutation({
    onSuccess: () => {
      setOutcome({ kind: 'undone' });
      refresh();
    },
    onError: () => setOutcome({ kind: 'failed' }),
  });
  const busy = record.isPending || remove.isPending;
  const canEdit = contacts.data?.canEdit === true;
  const recorded = outcome?.kind === 'recorded';
  const choices = fileChoices(canEdit, recorded);

  const answer = (choice: FileChoice) => {
    if (busy) return;
    if (choice === 'back') {
      onClose();
      return;
    }
    if (choice === 'undo') {
      if (outcome?.kind === 'recorded') remove.mutate({ organizationId, id: outcome.id });
      return;
    }
    record.mutate({ organizationId, leadId: lead.id, kind: choice });
  };

  // The file's keys: the numbers answer. Enter and Tab are left to the focused control.
  const onFileKey: RoomKeys = (event) => {
    const choice = fileChoiceOfKey(event.key, choices);
    if (!choice) return false;
    event.preventDefault();
    answer(choice);
    return true;
  };
  const latestKeys = useRef(onFileKey);
  latestKeys.current = onFileKey;
  useEffect(() => {
    keysRef.current = (event) => latestKeys.current(event);
    return () => {
      keysRef.current = null;
    };
  }, [keysRef]);

  // The report takes the focus when the file opens: Enter pressed once too often records nothing
  useEffect(() => {
    reportRef.current?.focus();
  }, []);

  const day = (value: Date | string) =>
    format.dateTime(new Date(value), { year: 'numeric', month: '2-digit', day: '2-digit' });
  const moment = (value: Date | string) =>
    format.dateTime(new Date(value), {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  const latest = contacts.data?.recent[0];
  const report =
    outcome?.kind === 'recorded'
      ? t('recorded', { kind: tKinds(outcome.contact) })
      : outcome?.kind === 'undone'
        ? t('undone')
        : outcome?.kind === 'failed'
          ? t('failed')
          : contacts.isError
            ? t('readError')
            : !contacts.data
              ? t('reading')
              : latest
                ? t('latest', {
                    date: moment(latest.contactedAt),
                    kind: tKinds(latest.kind),
                    total: contacts.data.total,
                  })
                : t('noContact');
  const company = lead.company || tLeads('noCompany');
  const marks = lead.mqlLevel === 'interest' ? 2 : lead.mqlLevel === 'fit' ? 1 : 0;

  return (
    <div className="absolute inset-x-4 top-20 bottom-4 flex flex-col gap-4 overflow-y-auto lg:inset-x-6 lg:bottom-6 lg:flex-row lg:items-end lg:overflow-visible">
      {/* What the room says about the file, and what the president answers */}
      <div className={cn(PANEL, 'shrink-0 space-y-3 px-5 pt-4 pb-6 lg:w-[26rem]')}>
        {header}
        <div ref={reportRef} tabIndex={-1} className="outline-none">
          <p className="text-base leading-relaxed font-medium" aria-live="polite">
            {report}
          </p>
          {contacts.data && !canEdit && (
            <p className="mt-2 text-sm text-[#d8d2c4]">{t('readOnly')}</p>
          )}
        </div>
        <h3 className={CAP}>{tImmersive('talk.you')}</h3>
        <ul className="space-y-2">
          {choices.map((choice, index) => {
            const main = index === 0 && (recorded || !canEdit);
            return (
              <li key={choice}>
                <button
                  type="button"
                  aria-disabled={busy}
                  onClick={() => answer(choice)}
                  className={cn(
                    'flex min-h-11 w-full items-center gap-3 border px-3 text-left text-sm font-bold aria-disabled:cursor-wait aria-disabled:opacity-60',
                    main
                      ? 'border-[#e9cf9a] bg-[#e9cf9a] text-[#1b2130]'
                      : 'border-[#f5f1e8]/35 bg-[#f5f1e8]/5 hover:border-[#e9cf9a] hover:bg-[#f5f1e8]/15',
                    FOCUS
                  )}
                >
                  <span className={cn(KEY, main && 'border-[#1b2130]/60')}>{index + 1}</span>
                  {t(`choices.${choice}`)}
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {/* The file on the room's table */}
      <section
        aria-label={t('label', { company })}
        className="flex min-h-[30rem] min-w-0 flex-1 flex-col border border-[#e9cf9a]/45 border-t-[3px] border-t-[#e9cf9a] bg-[linear-gradient(180deg,rgba(12,17,30,0.96)_0%,rgba(9,13,24,0.94)_100%)] shadow-[0_30px_60px_rgba(2,5,12,0.6)] lg:self-stretch"
      >
        <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2 border-b border-[#f5f1e8]/15 px-5 pt-4 pb-3">
          <div className="min-w-0 space-y-1.5">
            <p className={CAP}>{t('title')}</p>
            <h2 className="truncate text-xl font-bold">
              {company}
              <span className="ml-3 text-base font-medium text-[#d8d2c4]">
                {lead.name || tLead('nameNotSet')}
              </span>
            </h2>
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span
                style={{ color: LEAD_STATUS_COLORS[lead.status], borderColor: 'currentColor' }}
                className="inline-flex rounded-full border px-2.5 py-0.5 text-xs font-bold"
              >
                {lead.status in LEAD_STATUS_COLORS ? tStatus(lead.status as 'new') : lead.status}
              </span>
              <span className="flex items-center gap-2">
                <span aria-hidden="true" className="flex gap-1">
                  {[0, 1].map((mark) => (
                    <span
                      key={mark}
                      className={cn(
                        'h-2.5 w-2.5 rotate-45 border border-[#e9cf9a]',
                        mark < marks && 'bg-[#e9cf9a]'
                      )}
                    />
                  ))}
                </span>
                <span className="text-xs">
                  {tLeads('columns.mql')}：
                  {lead.mqlLevel ? tLevels(lead.mqlLevel) : tLeads('noLevel')}
                </span>
              </span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={cn(
              'flex min-h-11 shrink-0 items-center gap-2.5 px-2 text-sm font-bold hover:text-white',
              FOCUS
            )}
          >
            <span className={KEY}>Esc</span>
            {t('choices.back')}
          </button>
        </header>

        <div className="grid min-h-0 flex-1 gap-x-8 gap-y-6 overflow-y-auto px-5 py-5 md:grid-cols-[18rem_minmax(0,1fr)]">
          <div className="space-y-3">
            <h3 className={CAP}>{t('contact')}</h3>
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-xs text-[#bdb7a9]">{t('email')}</dt>
                <dd className="break-all">
                  <a
                    href={`mailto:${lead.email}`}
                    className={cn('underline underline-offset-4 hover:text-white', FOCUS)}
                  >
                    {lead.email}
                  </a>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-[#bdb7a9]">{t('phone')}</dt>
                <dd>
                  {lead.phone ? (
                    <a
                      href={`tel:${lead.phone}`}
                      className={cn('underline underline-offset-4 hover:text-white', FOCUS)}
                    >
                      {lead.phone}
                    </a>
                  ) : (
                    t('notSet')
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-[#bdb7a9]">{t('assignee')}</dt>
                <dd>{lead.assignee?.name ?? tLeads('unassigned')}</dd>
              </div>
              <div>
                <dt className="text-xs text-[#bdb7a9]">{t('created')}</dt>
                <dd className="tabular-nums">{day(lead.createdAt)}</dd>
              </div>
            </dl>
          </div>

          <div className="min-w-0 space-y-3">
            <h3 className={CAP}>{t('contacts')}</h3>
            {contacts.isError ? (
              <p className="text-sm leading-relaxed">{t('readError')}</p>
            ) : !contacts.data ? (
              <output className="flex items-center gap-3 text-sm text-[#d8d2c4]">
                <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                {t('reading')}
              </output>
            ) : contacts.data.total === 0 ? (
              <p className="text-sm text-[#d8d2c4]">{t('contactsEmpty')}</p>
            ) : (
              <>
                <p className="text-sm text-[#d8d2c4]">
                  {t('contactsSummary', {
                    total: contacts.data.total,
                    noAnswer: contacts.data.noAnswerCount,
                  })}
                </p>
                <ul className="space-y-3">
                  {contacts.data.recent.map((entry) => (
                    <li key={entry.id} className="flex gap-3 text-sm">
                      <span
                        aria-hidden="true"
                        className="mt-1.5 h-2.5 w-2.5 shrink-0 rotate-45 bg-[#e9cf9a]"
                      />
                      <span className="min-w-0">
                        <span className="block font-bold">{tKinds(entry.kind)}</span>
                        <span className="block text-xs text-[#d8d2c4]">
                          <span className="tabular-nums">{moment(entry.contactedAt)}</span>
                          {entry.createdBy?.name && `　${t('by', { name: entry.createdBy.name })}`}
                        </span>
                        {entry.note && (
                          <span className="mt-1 block break-words whitespace-pre-wrap">
                            {entry.note}
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[#f5f1e8]/15 px-5 py-3 text-sm text-[#d8d2c4]">
          <p className="text-xs">{t('detailHint')}</p>
          <Link
            href={`/${locale}/leads/${lead.id}`}
            onClick={onOpenDetail}
            className={cn(
              'inline-flex min-h-11 items-center underline underline-offset-4 hover:text-white',
              FOCUS
            )}
          >
            {t('openDetail')}
          </Link>
        </footer>
      </section>
    </div>
  );
}
