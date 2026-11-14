'use client';

import { formatDealDate, formatYen } from '@/components/features/deals/deal-format';
import { useDealMutations } from '@/components/features/deals/use-deal-mutations';
import { isImeKey } from '@/components/ui/ime';
import { Input } from '@/components/ui/input';
import {
  OPEN_DEAL_STAGES,
  type OpenDealStage,
  moveIsUndoable,
  skipsSqlDecision,
} from '@/lib/features/deals/types/pipeline';
import { addDays } from '@/lib/features/lead-follow-up/due';
import { TASK_TITLE_MAX } from '@/lib/features/lead-follow-up/types/schemas';
import { trpc } from '@/lib/trpc/client';
import { cn } from '@/lib/utils';
import { AlertTriangle, ArrowUpRight, Loader2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import {
  type FormEvent,
  type MutableRefObject,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { CAP, FOCUS, KEY, PANEL } from './office-hud';
import type { RoomKeys } from './office-room-contract';
import { ROOM_BOARD, ROOM_FRAME, RoomChoiceButton } from './office-room-parts';
import {
  type BoardDeal,
  DEAL_FILE_CHOICES,
  DEAL_KEYS,
  type DealFileAction,
  dealActionOfKey,
  dealActionOpen,
  dueShortcuts,
  stageAfter,
  stageBefore,
} from './rooms/deals-board';
import { useRoomKeys } from './use-room-keys';

/** The colour of an open stage on the dark board; the word is always shown with it */
export const DEAL_STAGE_COLORS: Readonly<Record<OpenDealStage, string>> = {
  qualification: '#93c5fd',
  discovery: '#c4b5fd',
  proposal: '#86efac',
  negotiation: '#e9cf9a',
};

type Outcome =
  // undoFailed: the undo did not go through, so the answer still stands and can be undone again
  | {
      kind: 'moved';
      from: { stage: OpenDealStage; probability: number };
      to: OpenDealStage;
      probability: number;
      /** The handoff sheet went out: a move back does not take it back, so there is no undo */
      handedOff: boolean;
      undoFailed?: boolean;
    }
  | { kind: 'done'; taskId: string; title: string; undoFailed?: boolean }
  | { kind: 'added'; title: string; dueOn: string }
  | { kind: 'undone' }
  | { kind: 'failed' };

/** What is open in place of the choices: the SQL decision of the lead, or a new next action */
type Matter = 'sql' | 'add';

// The field of the office: the same by day and by night (the office follows the clock, not the
// theme), like the fields of the conversation (office-talk-staff.tsx)
const FIELD = cn(
  'min-h-11 rounded-none border-[#f5f1e8]/45 bg-[#0b1020] text-base text-[#f5f1e8] placeholder:text-[#8b93a8] [color-scheme:dark] focus-visible:border-[#e9cf9a] focus-visible:ring-0 focus-visible:ring-offset-0 md:text-base dark:border-[#f5f1e8]/45 dark:bg-[#0b1020] dark:text-[#f5f1e8] dark:focus-visible:ring-0',
  FOCUS
);
const ACTION =
  'flex min-h-12 w-full items-center justify-center gap-2 border px-4 text-center text-base font-bold';
const ACTION_MAIN =
  'border-[#e9cf9a] bg-[#e9cf9a] text-[#1b2130] hover:bg-[#f3dfb4] aria-disabled:cursor-not-allowed aria-disabled:opacity-50';
const ACTION_PLAIN =
  'border-[#f5f1e8]/45 bg-[#101726] hover:border-[#e9cf9a] hover:bg-[#1c2540] aria-disabled:cursor-not-allowed aria-disabled:opacity-50';

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A deal file opened inside the sales floor of the full-screen office (#1171): the deal, where it
 * stands, and the president's answers that move it by one open stage, mark its next action as
 * done or set a new one, with the deals' and the next actions' own APIs, so the work ends inside
 * the office.
 *
 * An answer is carried out at once, so it can be undone (Z), like in a customer file. Every key
 * keeps its meaning (`DEAL_KEYS`): after an answer the others are closed until it is undone or
 * the file is opened again, so the same key pressed once too often never moves the deal twice.
 * The rules of a move are those of the normal view (use-stage-move.tsx):
 * - leaving 見極め asks for the lead's SQL decision first (#801). The question opens in the place
 *   of the choices and is answered with its own buttons, never with a number key; 不適格 loses
 *   the deal, which needs a reason, so it goes to the deal's page;
 * - a move that handed the lead off offers no undo (#720);
 * - an undo puts back the stage and the probability, not the SQL decision.
 * Winning and losing ask for more than a key (the day, the amount, the reason): they stay on the
 * deal's page of the normal view.
 */
export function OfficeDealFile({
  organizationId,
  deal,
  today,
  canEdit: mayEdit,
  gone = false,
  header,
  guide,
  keysRef,
  onClose,
  onLeaveOffice,
  onBusyChange,
}: {
  organizationId: string;
  /** The deal as the board holds it now: it follows the answers given here */
  deal: BoardDeal;
  /** Japan calendar day the board was read on */
  today: string;
  canEdit: boolean;
  /** The boards no longer hold the deal (deleted, closed elsewhere): shown as it was, no answers */
  gone?: boolean;
  /** Whose room this is: shown over the report, like over the board */
  header: ReactNode;
  /** The line that says who holds the room */
  guide?: ReactNode;
  /** Filled with the file's key handler while the file is open */
  keysRef: MutableRefObject<RoomKeys | null>;
  onClose: () => void;
  /** A page of the normal view is opened: the office closes */
  onLeaveOffice: () => void;
  /** Told while an answer is being saved (the office keeps the room open), and when it is over */
  onBusyChange?: (busy: boolean) => void;
}) {
  const t = useTranslations('aiOffice.immersive.room.dealFile');
  // What is shown may be out of date once the deal left the boards: nothing is changed then
  const canEdit = mayEdit && !gone;
  const tImmersive = useTranslations('aiOffice.immersive');
  const tDeals = useTranslations('deals');
  const tTasks = useTranslations('leadFollowUp.tasks');
  const locale = useLocale();
  const utils = trpc.useUtils();
  const reportRef = useRef<HTMLDivElement>(null);
  const matterRef = useRef<HTMLElement>(null);
  const titleId = useId();
  const dueId = useId();
  const sqlTitleId = useId();
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [matter, setMatter] = useState<Matter | null>(null);
  const [title, setTitle] = useState('');
  const [dueOn, setDueOn] = useState(() => addDays(today, 1));
  // The next action was sent without what it needs: said in place
  const [missing, setMissing] = useState(false);

  // A move reads the deals, the leads and the activity again, as in the normal view
  const { update } = useDealMutations({ toastErrors: false });
  // The next actions: the same queries the lead's card refreshes (lead-next-actions-card.tsx)
  const refreshTasks = () => {
    void utils.leadFollowUp.tasks.invalidate();
    void utils.leadFollowUp.dueTasks.invalidate({ organizationId });
    void utils.deals.board.invalidate({ organizationId });
  };
  const markTask = trpc.leadFollowUp.updateTask.useMutation({ onSuccess: refreshTasks });
  const addTask = trpc.leadFollowUp.createTask.useMutation({
    onSuccess: (_saved, input) => {
      setOutcome({ kind: 'added', title: input.title, dueOn: input.dueOn });
      setMatter(null);
      setTitle('');
      refreshTasks();
    },
  });

  const busy = update.isPending || markTask.isPending || addTask.isPending;
  useEffect(() => {
    onBusyChange?.(busy);
    return () => onBusyChange?.(false);
  }, [busy, onBusyChange]);
  // The answer that stands: its kind closes the answers of that kind (see dealActionOpen)
  const last =
    outcome?.kind === 'moved' || outcome?.kind === 'done' || outcome?.kind === 'added'
      ? outcome.kind
      : null;
  const acted = last !== null;
  const undoable =
    outcome?.kind === 'done' || (outcome?.kind === 'moved' && moveIsUndoable(outcome));
  const state = {
    canEdit,
    busy,
    last,
    undoable,
    stage: deal.stage,
    hasTask: deal.nextTask !== null,
  };
  const next = stageAfter(deal.stage);
  const previous = stageBefore(deal.stage);
  const stageName = (stage: OpenDealStage) => tDeals(`stages.${stage}`);
  const taskTitle = deal.nextTask ? (deal.nextTask.title ?? tTasks('nextMeetingTitle')) : null;
  const leadLabel = deal.company || deal.leadName || '';

  const failed = () => setOutcome({ kind: 'failed' });
  const moveTo = (to: OpenDealStage, sqlDecision?: 'qualified') => {
    const from = { stage: deal.stage as OpenDealStage, probability: deal.probability };
    update.mutate(
      { organizationId, dealId: deal.id, stage: to, ...(sqlDecision ? { sqlDecision } : {}) },
      {
        onSuccess: (saved) =>
          setOutcome({
            kind: 'moved',
            from,
            to,
            probability: saved.probability,
            handedOff: saved.handedOff,
          }),
        onError: failed,
      }
    );
  };
  // The answer still stands when its undo fails: it is kept in hand, to be undone again
  const undoFailed = () =>
    setOutcome((current) =>
      current?.kind === 'moved' || current?.kind === 'done'
        ? { ...current, undoFailed: true }
        : { kind: 'failed' }
    );
  const undone = () => setOutcome({ kind: 'undone' });

  const answer = (action: DealFileAction) => {
    if (matter || !dealActionOpen(action, state)) return;
    if (action === 'advance' && next) {
      // The exit of 見極め is the SQL decision: asked first, in the place of the choices
      if (skipsSqlDecision(deal.stage, next, deal.leadSqlDecision)) {
        setMatter('sql');
        return;
      }
      moveTo(next);
    } else if (action === 'back' && previous) {
      moveTo(previous);
    } else if (action === 'done' && deal.nextTask && taskTitle) {
      const taskId = deal.nextTask.id;
      markTask.mutate(
        { organizationId, id: taskId, done: true },
        { onSuccess: () => setOutcome({ kind: 'done', taskId, title: taskTitle }), onError: failed }
      );
    } else if (action === 'add') {
      setMatter('add');
      return;
    } else if (action === 'undo' && outcome?.kind === 'moved') {
      // The stage and the probability the move reset; the SQL decision stays (the hearing's)
      update.mutate(
        {
          organizationId,
          dealId: deal.id,
          stage: outcome.from.stage,
          probability: outcome.from.probability,
        },
        { onSuccess: undone, onError: undoFailed }
      );
    } else if (action === 'undo' && outcome?.kind === 'done') {
      markTask.mutate(
        { organizationId, id: outcome.taskId, done: false },
        { onSuccess: undone, onError: undoFailed }
      );
    }
    // The answer is in the report: the focus goes there, off a button that is closed now
    reportRef.current?.focus();
  };

  const closeMatter = () => {
    setMatter(null);
    reportRef.current?.focus();
  };
  const qualify = () => {
    if (!next || busy) return;
    setMatter(null);
    moveTo(next, 'qualified');
    reportRef.current?.focus();
  };
  const dueValid = ISO_DAY.test(dueOn);
  const addClosed = title.trim() === '' || !dueValid || addTask.isPending;
  const saveTask = (event: FormEvent) => {
    event.preventDefault();
    if (addClosed) {
      setMissing(!addTask.isPending);
      return;
    }
    setMissing(false);
    addTask.mutate({
      organizationId,
      leadId: deal.leadId,
      title: title.trim(),
      dueOn,
      dealId: deal.id,
    });
  };

  // The file's keys: each one keeps its meaning, and one that is closed right now does nothing
  // (it is still used up, so it never reaches the room behind the file). While a matter is open,
  // the keys belong to what is typed there and Esc closes the matter, except while it is being
  // saved: the request is on its way, and going back would look like giving it up.
  const onFileKey: RoomKeys = (event) => {
    // A key of a Japanese conversion (IME) is never an answer: it belongs to what is being typed
    if (isImeKey(event)) return false;
    if (matter) {
      if (event.key !== 'Escape') return false;
      if (!addTask.isPending) closeMatter();
      return true;
    }
    // While an answer is on its way the file stays: closed, it would be carried out with nobody
    // told what came of it (a handoff that went out, a failure)
    if (event.key === 'Escape') return busy;
    const action = dealActionOfKey(event.key);
    if (!action) return false;
    event.preventDefault();
    answer(action);
    return true;
  };
  useRoomKeys(keysRef, onFileKey);

  // The report takes the focus when the file opens: Enter pressed once too often does nothing
  useEffect(() => {
    reportRef.current?.focus();
  }, []);
  // A question takes the focus on its words, not on an answer; the field of a next action is
  // focused by itself (autoFocus)
  useEffect(() => {
    if (matter === 'sql') matterRef.current?.focus();
  }, [matter]);
  // A next action that was set is told in the report: the focus goes there, off the field that
  // is gone now
  const addedNow = outcome?.kind === 'added';
  useEffect(() => {
    if (addedNow) reportRef.current?.focus();
  }, [addedNow]);

  const standing = t('standing', {
    stage: tDeals(`stages.${deal.stage}`),
    probability: deal.probability,
  });
  const report =
    outcome?.kind === 'moved'
      ? outcome.undoFailed
        ? t('undoFailed')
        : t(outcome.handedOff ? 'movedHandedOff' : 'moved', {
            stage: stageName(outcome.to),
            probability: outcome.probability,
          })
      : outcome?.kind === 'done'
        ? outcome.undoFailed
          ? t('undoFailed')
          : t('done', { title: outcome.title })
        : outcome?.kind === 'added'
          ? t('added', { title: outcome.title, date: formatDealDate(outcome.dueOn) })
          : outcome?.kind === 'undone'
            ? t('undone')
            : outcome?.kind === 'failed'
              ? t('failed')
              : deal.nextTask && taskTitle
                ? `${standing}${t('next', {
                    date: formatDealDate(deal.nextTask.dueOn),
                    title: taskTitle,
                  })}`
                : `${standing}${t('noNext')}`;
  const choiceLabel = (choice: (typeof DEAL_FILE_CHOICES)[number]) =>
    choice === 'advance'
      ? next
        ? // The exit of 見極め asks first: said on the choice, so the question is no surprise
          t(
            skipsSqlDecision(deal.stage, next, deal.leadSqlDecision)
              ? 'choices.advanceSql'
              : 'choices.advance',
            { stage: stageName(next) }
          )
        : t('choices.advanceEnd')
      : choice === 'back'
        ? previous
          ? t('choices.back', { stage: stageName(previous) })
          : t('choices.backStart')
        : t(`choices.${choice}`);
  const dealHref = `/${locale}/deals/${deal.id}`;
  const none = t('notSet');

  return (
    <div className={ROOM_FRAME}>
      {/* What the room says about the deal, and what the president answers */}
      <div className={cn(PANEL, 'shrink-0 space-y-3 px-5 pt-4 pb-6 lg:w-[26rem]')}>
        {header}
        <div ref={reportRef} tabIndex={-1} className="space-y-2 outline-none">
          {guide}
          <p className="text-base leading-relaxed font-medium" aria-live="polite">
            {report}
          </p>
          {!canEdit && <p className="text-sm text-[#d8d2c4]">{t(gone ? 'gone' : 'readOnly')}</p>}
        </div>

        {canEdit && matter === 'sql' && next && (
          // The question takes the focus as a whole, not an answer: it is read out from its title,
          // and Enter pressed once more decides nothing
          <section
            ref={matterRef}
            aria-labelledby={sqlTitleId}
            tabIndex={-1}
            className="flex flex-col gap-2 outline-none"
          >
            <h3 id={sqlTitleId} className={CAP}>
              {t('sql.title')}
            </h3>
            <p className="text-sm leading-relaxed">
              {leadLabel
                ? tDeals('sqlDialog.description', { lead: leadLabel, stage: stageName(next) })
                : tDeals('sqlDialog.descriptionUnnamed', { stage: stageName(next) })}
            </p>
            <p className="text-sm leading-relaxed text-[#d8d2c4]">
              {tDeals('sqlDialog.qualifiedHint')}
            </p>
            <button type="button" onClick={qualify} className={cn(ACTION, ACTION_MAIN, FOCUS)}>
              {tDeals('sqlDialog.qualified', { stage: stageName(next) })}
            </button>
            <Link
              href={dealHref}
              onClick={onLeaveOffice}
              className={cn(ACTION, ACTION_PLAIN, FOCUS)}
            >
              {t('sql.notQualified')}
              <ArrowUpRight className="h-4 w-4 shrink-0" aria-hidden="true" />
            </Link>
            <MatterBack onBack={closeMatter}>{t('sql.back')}</MatterBack>
          </section>
        )}

        {canEdit && matter === 'add' && (
          <form onSubmit={saveTask} className="flex flex-col gap-2">
            <h3 className={CAP}>{t('add.title')}</h3>
            <label htmlFor={titleId} className="text-sm text-[#d8d2c4]">
              {t('add.what')}
            </label>
            <Input
              id={titleId}
              // The field opens on the president's own answer, in the place of the choices
              autoFocus
              aria-required="true"
              value={title}
              maxLength={TASK_TITLE_MAX}
              autoComplete="off"
              onChange={(event) => setTitle(event.target.value)}
              className={FIELD}
            />
            <label htmlFor={dueId} className="text-sm text-[#d8d2c4]">
              {t('add.due')}
            </label>
            <Input
              id={dueId}
              type="date"
              min={today}
              aria-required="true"
              value={dueOn}
              onChange={(event) => setDueOn(event.target.value)}
              className={FIELD}
            />
            {/* The days asked for most, a press away: buttons of the field, not number keys */}
            <div className="flex flex-wrap gap-2">
              {dueShortcuts(today).map((shortcut) => (
                <button
                  key={shortcut.key}
                  type="button"
                  aria-pressed={dueOn === shortcut.day}
                  onClick={() => setDueOn(shortcut.day)}
                  className={cn(
                    'min-h-11 border px-3 text-sm font-bold',
                    dueOn === shortcut.day
                      ? 'border-[#e9cf9a] bg-[#e9cf9a]/15'
                      : 'border-[#f5f1e8]/35 hover:border-[#e9cf9a]',
                    FOCUS
                  )}
                >
                  {t(`add.days.${shortcut.key}`)}
                </button>
              ))}
            </div>
            {missing && (
              <p role="alert" className="text-sm font-bold text-[#fca5a5]">
                {t('add.missing')}
              </p>
            )}
            {addTask.isError && (
              <p role="alert" className="text-sm font-bold text-[#fca5a5]">
                <AlertTriangle className="mr-1.5 inline h-4 w-4 align-[-2px]" aria-hidden="true" />
                {t('failed')}
              </p>
            )}
            <button
              type="submit"
              aria-disabled={addClosed}
              className={cn(ACTION, ACTION_MAIN, FOCUS)}
            >
              {addTask.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {t('add.save')}
            </button>
            <MatterBack closed={addTask.isPending} onBack={closeMatter}>
              {t('add.back')}
            </MatterBack>
          </form>
        )}

        {(!matter || !canEdit) && (
          <>
            <h3 className={CAP}>{tImmersive('talk.you')}</h3>
            <ul className="space-y-2">
              {/* The answers keep their places and keys; one that is not carried out right now
                  is closed. Hidden from who may not change deals */}
              {canEdit &&
                DEAL_FILE_CHOICES.map((choice) => (
                  <li key={choice}>
                    <RoomChoiceButton
                      keyCap={DEAL_KEYS[choice]}
                      closed={!dealActionOpen(choice, state)}
                      waiting={busy}
                      onClick={() => answer(choice)}
                    >
                      {choiceLabel(choice)}
                    </RoomChoiceButton>
                  </li>
                ))}
              {acted && undoable && (
                <li>
                  <RoomChoiceButton
                    keyCap={DEAL_KEYS.undo}
                    closed={!dealActionOpen('undo', state)}
                    waiting={busy}
                    onClick={() => answer('undo')}
                  >
                    {t('choices.undo')}
                  </RoomChoiceButton>
                </li>
              )}
              <li>
                <RoomChoiceButton
                  keyCap="Esc"
                  main={(acted || !canEdit) && !busy}
                  closed={busy}
                  waiting={busy}
                  onClick={() => {
                    if (!busy) onClose();
                  }}
                >
                  {t('choices.close')}
                </RoomChoiceButton>
              </li>
            </ul>
          </>
        )}
      </div>

      {/* The file on the room's table */}
      <section aria-label={t('label', { name: deal.name })} className={ROOM_BOARD}>
        <header className="space-y-3 border-b border-[#f5f1e8]/15 px-5 pt-4 pb-4">
          <div className="min-w-0 space-y-1.5">
            <p className={CAP}>{t('title')}</p>
            <h2 className="truncate text-xl font-bold">
              {deal.name}
              <span className="ml-3 text-base font-medium text-[#d8d2c4]">
                {leadLabel || t('noLead')}
              </span>
            </h2>
          </div>
          {/* Where the deal stands among the open stages: said in words, the colour only adds */}
          <ol aria-label={t('stages')} className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {OPEN_DEAL_STAGES.map((stage) => {
              const current = stage === deal.stage;
              return (
                <li
                  key={stage}
                  aria-current={current ? 'step' : undefined}
                  style={current ? { borderColor: DEAL_STAGE_COLORS[stage] } : undefined}
                  className={cn(
                    'border px-3 py-2 text-sm',
                    current
                      ? 'border-2 bg-[#f5f1e8]/10 font-bold'
                      : 'border-[#f5f1e8]/20 text-[#bdb7a9]'
                  )}
                >
                  {stageName(stage)}
                  {current && <span className="ml-2 text-xs font-medium">{t('here')}</span>}
                </li>
              );
            })}
          </ol>
        </header>

        <div className="grid min-h-0 flex-1 gap-x-8 gap-y-6 overflow-y-auto px-5 py-5 md:grid-cols-[18rem_minmax(0,1fr)]">
          <div className="space-y-3">
            <h3 className={CAP}>{t('deal')}</h3>
            <dl className="space-y-3 text-sm">
              <Fact label={tDeals('fields.kind')}>{tDeals(`kinds.${deal.kind}`)}</Fact>
              <Fact label={tDeals('fields.amount')}>
                <span className="tabular-nums">
                  {formatYen(deal.amount, locale) ?? t('noAmount')}
                </span>
              </Fact>
              <Fact label={tDeals('fields.probability')}>
                <span className="tabular-nums">{deal.probability}%</span>
              </Fact>
              <Fact label={tDeals('fields.expectedCloseOn')}>
                <span className="tabular-nums">
                  {deal.expectedCloseOn ? formatDealDate(deal.expectedCloseOn) : none}
                </span>
                {deal.expectedCloseOn && deal.expectedCloseOn < today && (
                  <span className="ml-2 font-bold text-[#fca5a5]">{t('closeLate')}</span>
                )}
              </Fact>
              <Fact label={tDeals('fields.owner')}>{deal.ownerName ?? t('unassigned')}</Fact>
            </dl>
          </div>

          <div className="min-w-0 space-y-3">
            <h3 className={CAP}>{t('nextAction')}</h3>
            {deal.nextTask && taskTitle ? (
              <div className="space-y-1 text-sm">
                <p className="font-bold break-words">{taskTitle}</p>
                <p className="text-[#d8d2c4]">
                  {t('dueOn', { date: formatDealDate(deal.nextTask.dueOn) })}
                  {deal.nextTask.dueOn < today && (
                    <span className="ml-2 font-bold text-[#fca5a5]">{t('late')}</span>
                  )}
                  {deal.nextTask.kind === 'takeaway' && (
                    <span className="ml-2">{t('takeaway')}</span>
                  )}
                </p>
              </div>
            ) : (
              <p className="text-sm font-bold text-[#fcd34d]">{t('nextActionMissing')}</p>
            )}
          </div>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[#f5f1e8]/15 px-5 py-3 text-sm text-[#d8d2c4]">
          <p className="text-xs">{t('detailHint')}</p>
          <Link
            href={dealHref}
            onClick={onLeaveOffice}
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

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-[#bdb7a9]">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** The way back from a matter to the choices (Esc) */
function MatterBack({
  closed = false,
  onBack,
  children,
}: {
  /** Being saved: no way back meanwhile */
  closed?: boolean;
  onBack: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      // Not disabled: a disabled button would drop the focus out of the room
      aria-disabled={closed || undefined}
      onClick={() => {
        if (!closed) onBack();
      }}
      className={cn(
        'flex min-h-11 w-full items-center gap-3 border px-4 text-left text-sm font-bold',
        ACTION_PLAIN,
        FOCUS
      )}
    >
      <span className={KEY}>Esc</span>
      {children}
    </button>
  );
}
