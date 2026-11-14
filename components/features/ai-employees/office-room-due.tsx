'use client';

import { isImeKey } from '@/components/ui/ime';
import type { DeskStatus } from '@/lib/features/ai-employees/office';
import type { RobotLook } from '@/lib/features/ai-employees/types/profile';
import type { AiEmployeeRole } from '@/lib/features/ai-employees/types/roles';
import { DUE_TASKS_MAX, type DueTaskView } from '@/lib/features/lead-follow-up/types/schemas';
import { trpc } from '@/lib/trpc/client';
import { cn } from '@/lib/utils';
import { Check, ChevronRight, Loader2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { type MutableRefObject, useEffect, useRef, useState } from 'react';
import { CAP, FOCUS, KEY, PANEL } from './office-hud';
import type { RoomKeys } from './office-lead-file';
import {
  ROOM_BOARD,
  ROOM_FRAME,
  RoomChoiceButton,
  RoomGuideHeader,
  RoomGuideLine,
} from './office-room-parts';
import {
  DUE_KEYS,
  type DueAction,
  daysOverdue,
  dueActionOfKey,
  dueActionOpen,
  dueState,
  roomGuide,
} from './office-rooms';

type Outcome = 'done' | 'undone' | 'failed' | 'undoFailed';

/**
 * The reception of the full-screen office (#1133): what is due comes to the president one at a
 * time, instead of the president looking for it in a list. The room hands over the user's own
 * next actions and takeaways due today or earlier (`leadFollowUp.dueTasks`, oldest first), and an
 * answer marks one as done (`leadFollowUp.updateTask`) or leaves it for later.
 *
 * The queue is the list as it was when the room opened: marking one as done does not shift the
 * others under the president's finger. An answer is carried out at once, so it can be undone.
 * Every key keeps its meaning (`DUE_KEYS`): right after one was marked, marking is closed until
 * the president goes on, so the same key never completes the next one unseen.
 */
export function OfficeRoomDue({
  organizationId,
  role,
  status,
  employeeName,
  look,
  keysRef,
  onOpenNormal,
}: {
  organizationId: string;
  role: AiEmployeeRole;
  status: DeskStatus;
  /** The name of the AI employee of the room; null while the seat is vacant */
  employeeName: string | null;
  /** How the employee was customized (#1134) */
  look?: RobotLook;
  /** Filled with the room's key handler while the room is shown */
  keysRef: MutableRefObject<RoomKeys | null>;
  /** A page of the normal view is opened: the office closes */
  onOpenNormal: () => void;
}) {
  const t = useTranslations('aiOffice.immersive.room');
  const tDue = useTranslations('aiOffice.immersive.room.due');
  const tOffice = useTranslations('aiOffice');
  const tImmersive = useTranslations('aiOffice.immersive');
  const tTasks = useTranslations('leadFollowUp.tasks');
  const locale = useLocale();
  const utils = trpc.useUtils();
  const reportRef = useRef<HTMLDivElement>(null);
  // The queue as it was when the room opened, where the president is in it, and what was done
  const [queue, setQueue] = useState<DueTaskView[] | null>(null);
  const [index, setIndex] = useState(0);
  const [doneIds, setDoneIds] = useState<ReadonlySet<string>>(new Set());
  const [justDone, setJustDone] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const due = trpc.leadFollowUp.dueTasks.useQuery({
    organizationId,
    scope: 'mine',
    limit: DUE_TASKS_MAX,
  });
  const loaded = due.data;
  useEffect(() => {
    if (loaded) setQueue((current) => current ?? loaded.items);
  }, [loaded]);

  const refresh = () => {
    void utils.leadFollowUp.tasks.invalidate();
    void utils.leadFollowUp.dueTasks.invalidate({ organizationId });
    void utils.deals.board.invalidate({ organizationId });
  };
  const update = trpc.leadFollowUp.updateTask.useMutation({
    onSuccess: (_saved, input) => {
      const marked = input.done === true;
      setDoneIds((current) => {
        const next = new Set(current);
        if (marked) next.add(input.id);
        else next.delete(input.id);
        return next;
      });
      setJustDone(marked ? input.id : null);
      setOutcome(marked ? 'done' : 'undone');
      refresh();
    },
    // A mark that could not be taken back is still there, and can be taken back again
    onError: (_error, input) => setOutcome(input.done === false ? 'undoFailed' : 'failed'),
  });

  const forbidden = due.error?.data?.code === 'FORBIDDEN';
  const canEdit = loaded?.canEdit === true;
  const today = loaded?.today ?? '';
  const count = queue?.length ?? 0;
  const finished = queue !== null && index >= count;
  const task = queue?.[index] ?? null;
  const state = { canEdit, justDone: justDone !== null, finished, busy: update.isPending };
  const guide = roomGuide(status);
  const roleTitle = tOffice(`roles.${role}.title`);
  const title = (entry: DueTaskView) => entry.title ?? tTasks('nextMeetingTitle');
  const who = (entry: DueTaskView) =>
    [entry.lead.company, entry.lead.name].filter(Boolean).join('　') || tDue('noLead');
  const dueText = (entry: DueTaskView) => {
    const days = daysOverdue(entry.dueOn, today);
    return days > 0 ? tDue('overdue', { days }) : tDue('dueToday');
  };

  const answer = (action: DueAction) => {
    if (!queue || !dueActionOpen(action, state)) return;
    if (action === 'next') {
      setIndex((current) => current + 1);
      setJustDone(null);
      setOutcome(null);
    } else if (action === 'done') {
      if (task) update.mutate({ organizationId, id: task.id, done: true });
    } else if (justDone) {
      update.mutate({ organizationId, id: justDone, done: false });
    }
    // The answer is in the report: the focus goes there, off a button that is closed now
    reportRef.current?.focus();
  };

  // The room's keys: each one keeps its meaning, and one that is closed right now does nothing.
  // Esc goes back to the floor, and is the office's.
  const onRoomKey: RoomKeys = (event) => {
    // A key of a Japanese conversion (IME) is never an answer: it belongs to what is being typed
    if (isImeKey(event)) return false;
    const action = dueActionOfKey(event.key);
    if (!action) return false;
    event.preventDefault();
    answer(action);
    return true;
  };
  const latestKeys = useRef(onRoomKey);
  latestKeys.current = onRoomKey;
  useEffect(() => {
    keysRef.current = (event) => latestKeys.current(event);
    return () => {
      keysRef.current = null;
    };
  }, [keysRef]);

  const report = forbidden
    ? tDue('forbidden')
    : due.isError
      ? tDue('error')
      : !queue
        ? tDue('reading')
        : outcome === 'failed'
          ? tDue('failed')
          : outcome === 'undoFailed'
            ? tDue('undoFailed')
            : outcome === 'done'
              ? tDue('done')
              : outcome === 'undone'
                ? tDue('undone')
                : count === 0
                  ? tDue('empty')
                  : finished
                    ? tDue('finished', { done: doneIds.size, left: count - doneIds.size })
                    : index === 0
                      ? tDue('report', { total: count, index: 1 })
                      : tDue('reportNext', { total: count, index: index + 1 });
  const more = loaded ? loaded.total - loaded.items.length : 0;
  // The answer the room expects next: filled
  const mainAction: DueAction | null = dueActionOpen('done', { ...state, busy: false })
    ? 'done'
    : finished
      ? null
      : 'next';

  return (
    <div className={ROOM_FRAME}>
      {/* Whose room this is, what is handed over, and what the president answers */}
      <div className={cn(PANEL, 'shrink-0 space-y-3 px-5 pt-4 pb-6 lg:w-[26rem]')}>
        <RoomGuideHeader role={role} status={status} employeeName={employeeName} look={look} />
        {/* The report takes the focus when the room opens: Enter pressed once too often does nothing */}
        <div ref={reportRef} tabIndex={-1} data-autofocus="" className="space-y-2 outline-none">
          <RoomGuideLine>
            {t(`guide.${guide}`, { name: employeeName ?? roleTitle, role: roleTitle })}
          </RoomGuideLine>
          <p className="text-base leading-relaxed font-medium" aria-live="polite">
            {report}
          </p>
          {queue && count > 0 && !canEdit && (
            <p className="text-sm text-[#d8d2c4]">{tDue('readOnly')}</p>
          )}
        </div>
        {/* Once all were seen there is nothing left to answer: the way back is the room's (Esc) */}
        {queue && count > 0 && !finished && (
          <>
            <h3 className={CAP}>{tImmersive('talk.you')}</h3>
            <ul className="space-y-2">
              {/* The answers keep their places and keys. Marking is hidden from who may not mark,
                  and closed right after a mark and once all were seen */}
              {canEdit && (
                <li>
                  <RoomChoiceButton
                    keyCap={DUE_KEYS.done}
                    main={mainAction === 'done'}
                    closed={!dueActionOpen('done', state)}
                    waiting={update.isPending}
                    onClick={() => answer('done')}
                  >
                    {tDue('choices.done')}
                  </RoomChoiceButton>
                </li>
              )}
              <li>
                <RoomChoiceButton
                  keyCap={DUE_KEYS.next}
                  main={mainAction === 'next'}
                  closed={!dueActionOpen('next', state)}
                  waiting={update.isPending}
                  onClick={() => answer('next')}
                >
                  {tDue(justDone !== null ? 'choices.next' : 'choices.later')}
                </RoomChoiceButton>
              </li>
              {justDone !== null && (
                <li>
                  <RoomChoiceButton
                    keyCap={DUE_KEYS.undo}
                    closed={!dueActionOpen('undo', state)}
                    waiting={update.isPending}
                    onClick={() => answer('undo')}
                  >
                    {tDue('choices.undo')}
                  </RoomChoiceButton>
                </li>
              )}
            </ul>
          </>
        )}
      </div>

      {/* What is handed over now, and the order of the rest */}
      <section aria-label={tDue('board')} aria-busy={due.isFetching} className={ROOM_BOARD}>
        <header className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-[#f5f1e8]/15 px-5 pt-4 pb-3">
          <h2 className="text-xl font-bold">{tDue('board')}</h2>
          {task && (
            <p className="text-sm text-[#d8d2c4] tabular-nums">
              {tDue('position', { total: count, index: index + 1 })}
            </p>
          )}
        </header>

        {forbidden ? (
          <p className="m-auto max-w-md px-6 text-center text-base leading-relaxed">
            {tDue('forbidden')}
          </p>
        ) : due.isError ? (
          <p className="m-auto max-w-md px-6 text-center text-base leading-relaxed">
            {tDue('error')}
          </p>
        ) : !queue ? (
          <output className="m-auto flex items-center gap-3 text-sm text-[#d8d2c4]">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
            {tDue('reading')}
          </output>
        ) : count === 0 ? (
          <p className="m-auto max-w-md px-6 text-center text-base leading-relaxed">
            {tDue('empty')}
          </p>
        ) : (
          <div className="grid min-h-0 flex-1 gap-x-8 gap-y-6 overflow-y-auto px-5 py-5 md:grid-cols-[minmax(0,1fr)_20rem]">
            {/* The one in the president's hands */}
            <div className="min-w-0 space-y-4">
              {task ? (
                <article
                  aria-label={title(task)}
                  className="space-y-4 border border-[#e9cf9a]/55 bg-[#f5f1e8]/5 px-5 py-5"
                >
                  <p className="flex flex-wrap items-center gap-3 text-sm font-bold">
                    <span
                      className={cn(
                        'inline-flex rounded-full border px-2.5 py-0.5 text-xs',
                        daysOverdue(task.dueOn, today) > 0
                          ? 'border-[#fca5a5] text-[#fca5a5]'
                          : 'border-[#e9cf9a] text-[#e9cf9a]'
                      )}
                    >
                      {dueText(task)}
                    </span>
                    {task.kind === 'takeaway' && (
                      <span className="inline-flex rounded-full border border-[#d8d2c4] px-2.5 py-0.5 text-xs text-[#d8d2c4]">
                        {tDue('takeaway')}
                      </span>
                    )}
                    {doneIds.has(task.id) && (
                      <span className="inline-flex items-center gap-1 text-xs text-[#86efac]">
                        <Check className="h-4 w-4" aria-hidden="true" />
                        {tDue('states.done')}
                      </span>
                    )}
                  </p>
                  <h3 className="text-2xl leading-snug font-bold break-words">{title(task)}</h3>
                  <dl className="space-y-3 text-sm">
                    <div>
                      <dt className="text-xs text-[#bdb7a9]">{tDue('lead')}</dt>
                      <dd className="text-base">{who(task)}</dd>
                    </div>
                    {(task.checkWithUser?.name ?? task.checkWith) && (
                      <div>
                        <dd>
                          {tDue('checkWith', {
                            name: task.checkWithUser?.name ?? task.checkWith ?? '',
                          })}
                        </dd>
                      </div>
                    )}
                    {task.note && (
                      <div>
                        <dt className="text-xs text-[#bdb7a9]">{tDue('note')}</dt>
                        <dd className="break-words whitespace-pre-wrap">{task.note}</dd>
                      </div>
                    )}
                  </dl>
                  <Link
                    href={`/${locale}/leads/${task.leadId}`}
                    onClick={onOpenNormal}
                    className={cn(
                      'inline-flex min-h-11 items-center gap-1 text-sm underline underline-offset-4 hover:text-white',
                      FOCUS
                    )}
                  >
                    {tDue('openLead')}
                    <ChevronRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </article>
              ) : (
                <p className="text-base leading-relaxed">{tDue('allSeen')}</p>
              )}
              {more > 0 && (
                <p className="text-sm text-[#d8d2c4]">{tDue('more', { count: more })}</p>
              )}
            </div>

            {/* The order of the queue, and where each one stands */}
            <div className="min-w-0 space-y-3">
              <h3 className={CAP}>{tDue('queue')}</h3>
              <ol className="space-y-1">
                {queue.map((entry, position) => {
                  const state = dueState(position, index, doneIds.has(entry.id));
                  return (
                    <li
                      key={entry.id}
                      aria-current={state === 'current' ? 'step' : undefined}
                      className={cn(
                        'flex items-start gap-3 border-l-2 px-3 py-2 text-sm',
                        state === 'current'
                          ? 'border-[#e9cf9a] bg-[#e9cf9a]/10'
                          : 'border-transparent',
                        state === 'done' && 'text-[#bdb7a9]'
                      )}
                    >
                      <span className="mt-0.5 w-14 shrink-0 text-xs font-bold text-[#d8d2c4]">
                        {tDue(`states.${state}`)}
                      </span>
                      <span className="min-w-0">
                        <span className={cn('block truncate', state === 'done' && 'line-through')}>
                          {title(entry)}
                        </span>
                        <span className="block truncate text-xs text-[#d8d2c4]">{who(entry)}</span>
                      </span>
                    </li>
                  );
                })}
              </ol>
            </div>
          </div>
        )}

        <footer className="flex flex-wrap items-center justify-end gap-3 border-t border-[#f5f1e8]/15 px-5 py-3 text-sm text-[#d8d2c4]">
          <Link
            href={`/${locale}/today`}
            onClick={onOpenNormal}
            className={cn(
              'inline-flex min-h-11 items-center underline underline-offset-4 hover:text-white',
              FOCUS
            )}
          >
            {tDue('openToday')}
          </Link>
        </footer>
      </section>
    </div>
  );
}
