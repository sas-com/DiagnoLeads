'use client';

import { isImeKey } from '@/components/ui/ime';
import type { DeskStatus } from '@/lib/features/ai-employees/office';
import type { RobotLook } from '@/lib/features/ai-employees/types/profile';
import type { AiEmployeeRole } from '@/lib/features/ai-employees/types/roles';
import { DUE_TASKS_MAX } from '@/lib/features/lead-follow-up/types/schemas';
import { trpc } from '@/lib/trpc/client';
import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type MutableRefObject, useEffect, useRef, useState } from 'react';
import { CAP, PANEL } from './office-hud';
import type { RoomKeys } from './office-lead-file';
import { GUIDE_PANEL } from './office-reception-parts';
import { OfficeRoomDue } from './office-room-due';
import { MEMBERS_SHELF_MAX, OfficeRoomMembers } from './office-room-members';
import {
  ROOM_BOARD,
  ROOM_FRAME,
  RoomChoiceButton,
  RoomGuideHeader,
  RoomGuideLine,
} from './office-room-parts';
import { OfficeRoomSettings } from './office-room-settings';
import { roomGuide } from './office-rooms';
import {
  READ_OFFLINE_FAILS,
  RECEPTION_SHELVES,
  type ReceptionShelf,
  SHELF_KEYS,
  dueFigures,
  dueLine,
  invitationFigures,
  membersLine,
  queryFailure,
  queryStale,
  shelfOfKey,
} from './rooms/reception';

/**
 * The reception of the full-screen office, the back office's room (#1196, Epic #1195). At the
 * counter the back office reports the figures of the general affairs as they are recorded (what is
 * due for the user, the members, the invitations not accepted yet), and the president chooses a
 * shelf: what is due (#1133), the members and invitations, the doors to the settings.
 *
 * A key of the counter only opens a shelf and carries nothing out, so the numbers are free for the
 * answers of the shelf that opens. Esc steps back one at a time: shelf, counter, floor. A figure
 * that could not be read, or that the user may not see, is not said.
 */
export function OfficeRoomReception({
  organizationId,
  role,
  status,
  employeeName,
  look,
  keysRef,
  onOpenNormal,
  onFileOpenChange,
  onBusyChange,
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
  /** Told when a shelf opens or closes: while one is open, Esc closes it, not the room */
  onFileOpenChange: (open: boolean) => void;
  /** Told while an answer given on a shelf is being saved: the office keeps the room open (#1236) */
  onBusyChange: (busy: boolean) => void;
}) {
  const t = useTranslations('aiOffice.immersive.room');
  const tDesk = useTranslations('aiOffice.immersive.room.reception');
  const tOffice = useTranslations('aiOffice');
  const tImmersive = useTranslations('aiOffice.immersive');
  const rootRef = useRef<HTMLDivElement>(null);
  const shelfKeys = useRef<RoomKeys | null>(null);
  const [shelf, setShelf] = useState<ReceptionShelf | null>(null);
  // An answer given on a shelf is being saved: no way back meanwhile, neither to the counter nor
  // to the floor. Leaving would look like giving it up, and the request is already on its way.
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    onBusyChange(busy);
    return () => onBusyChange(false);
  }, [busy, onBusyChange]);

  // The same questions the shelves ask: what the counter reports is what the shelf then shows
  const due = trpc.leadFollowUp.dueTasks.useQuery(
    { organizationId, scope: 'mine', limit: DUE_TASKS_MAX },
    READ_OFFLINE_FAILS
  );
  const members = trpc.members.list.useQuery(
    { organizationId, limit: MEMBERS_SHELF_MAX, offset: 0 },
    READ_OFFLINE_FAILS
  );
  const invitations = trpc.members.listInvitations.useQuery({ organizationId }, READ_OFFLINE_FAILS);

  const shelfOpen = shelf !== null;
  useEffect(() => {
    onFileOpenChange(shelfOpen);
    return () => onFileOpenChange(false);
  }, [shelfOpen, onFileOpenChange]);

  // A shelf that opens or closes hands the focus to what is reported now, never to a button:
  // Enter pressed once too often does nothing
  const shown = useRef(shelf);
  useEffect(() => {
    if (shown.current === shelf) return;
    shown.current = shelf;
    rootRef.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
  }, [shelf]);

  const onRoomKey: RoomKeys = (event) => {
    // A key of a Japanese conversion (IME) is never an answer: it belongs to what is being typed
    if (isImeKey(event)) return false;
    if (shelf) {
      if (shelfKeys.current?.(event)) return true;
      if (event.key !== 'Escape') return false;
      event.preventDefault();
      if (!busy) setShelf(null);
      return true;
    }
    const opened = shelfOfKey(event.key);
    if (!opened) return false;
    event.preventDefault();
    setShelf(opened);
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

  const back = () => setShelf(null);
  const guideProps = { role, status, employeeName, look };

  const dueKnown = dueFigures(due.data, queryFailure(due));
  const invited = invitationFigures(invitations.data, queryFailure(invitations));
  const memberCount = members.data?.total ?? null;
  const aboutDue = dueLine(dueKnown);
  const aboutMembers = membersLine(memberCount, invited);
  // Said once, when all three are known: a sentence that grows as each arrives is read out anew
  const reading =
    dueKnown.state === 'reading' ||
    (!members.data && !members.isError) ||
    invited.state === 'reading';
  const roleTitle = tOffice(`roles.${role}.title`);
  const unread = (
    <span className="text-sm font-normal text-[#d8d2c4]">{tDesk('figures.unread')}</span>
  );
  const readingFigure = (
    <>
      <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
      <span className="sr-only">{tDesk('reading')}</span>
    </>
  );

  return (
    <div ref={rootRef} className="contents">
      {shelf === 'due' ? (
        <OfficeRoomDue
          organizationId={organizationId}
          {...guideProps}
          keysRef={shelfKeys}
          onOpenNormal={onOpenNormal}
          onBack={back}
          onBusyChange={setBusy}
        />
      ) : shelf === 'members' ? (
        <OfficeRoomMembers
          organizationId={organizationId}
          {...guideProps}
          keysRef={shelfKeys}
          onOpenNormal={onOpenNormal}
          onBack={back}
          onBusyChange={setBusy}
        />
      ) : shelf === 'settings' ? (
        <OfficeRoomSettings
          {...guideProps}
          keysRef={shelfKeys}
          onOpenNormal={onOpenNormal}
          onBack={back}
        />
      ) : (
        <div className={ROOM_FRAME}>
          {/* Whose room this is, what the general affairs stand at, and which shelf to open */}
          <div className={cn(PANEL, GUIDE_PANEL)}>
            <RoomGuideHeader {...guideProps} />
            <div tabIndex={-1} data-autofocus="" className="space-y-2 outline-none">
              <RoomGuideLine>
                {t(`guide.${roomGuide(status)}`, {
                  name: employeeName ?? roleTitle,
                  role: roleTitle,
                })}
              </RoomGuideLine>
              <p className="text-base leading-relaxed font-medium" aria-live="polite">
                {reading
                  ? tDesk('reading')
                  : [
                      aboutDue &&
                        tDesk(`due.${aboutDue}`, {
                          total: dueKnown.state === 'ready' ? dueKnown.total : 0,
                          overdue: dueKnown.state === 'ready' ? (dueKnown.overdue ?? 0) : 0,
                        }),
                      aboutMembers &&
                        tDesk(`members.${aboutMembers}`, {
                          count: memberCount ?? 0,
                          waiting: invited.state === 'ready' ? invited.waiting : 0,
                        }),
                      // Said, not left out: who listens does not see the board
                      // Only when there is no figure at all: a refetch that failed keeps the last one
                      memberCount === null && members.isError && tDesk('members.unread'),
                      memberCount !== null &&
                        invited.state === 'error' &&
                        tDesk('members.invitationsUnread'),
                      (queryStale(due) || queryStale(members) || queryStale(invitations)) &&
                        tDesk('stale'),
                      tDesk('ask'),
                    ]
                      .filter(Boolean)
                      .join('')}
              </p>
            </div>
            <h3 className={CAP}>{tImmersive('talk.you')}</h3>
            <ul className="space-y-2">
              {RECEPTION_SHELVES.map((entry) => (
                <li key={entry}>
                  <RoomChoiceButton
                    keyCap={SHELF_KEYS[entry]}
                    main={entry === 'due' && dueKnown.state === 'ready' && dueKnown.total > 0}
                    onClick={() => setShelf(entry)}
                  >
                    {tDesk(`choices.${entry}`)}
                  </RoomChoiceButton>
                </li>
              ))}
            </ul>
          </div>

          {/* The figures on the counter: only what is recorded */}
          <section aria-label={tDesk('board')} aria-busy={reading} className={ROOM_BOARD}>
            <header className="border-b border-[#f5f1e8]/15 px-5 pt-4 pb-3">
              <h2 className="text-xl font-bold">{tDesk('board')}</h2>
            </header>
            <dl className="grid min-h-0 flex-1 content-start gap-x-8 gap-y-6 overflow-y-auto px-5 py-6 md:grid-cols-3">
              <div className="space-y-1">
                <dt className={CAP}>{tDesk('figures.due')}</dt>
                <dd className="text-3xl font-bold tabular-nums">
                  {dueKnown.state === 'ready'
                    ? tDesk('figures.dueValue', { count: dueKnown.total })
                    : dueKnown.state === 'reading'
                      ? readingFigure
                      : unread}
                </dd>
                {dueKnown.state === 'ready' &&
                  dueKnown.overdue !== null &&
                  dueKnown.overdue > 0 && (
                    <dd className="text-sm text-[#fca5a5]">
                      {tDesk('figures.overdueValue', { count: dueKnown.overdue })}
                    </dd>
                  )}
              </div>
              <div className="space-y-1">
                <dt className={CAP}>{tDesk('figures.members')}</dt>
                <dd className="text-3xl font-bold tabular-nums">
                  {memberCount !== null
                    ? tDesk('figures.membersValue', { count: memberCount })
                    : members.isError
                      ? unread
                      : readingFigure}
                </dd>
              </div>
              <div className="space-y-1">
                <dt className={CAP}>{tDesk('figures.invitations')}</dt>
                <dd className="text-3xl font-bold tabular-nums">
                  {invited.state === 'ready' ? (
                    tDesk('figures.invitationsValue', { count: invited.waiting })
                  ) : invited.state === 'reading' ? (
                    readingFigure
                  ) : invited.state === 'hidden' ? (
                    <span className="text-sm font-normal text-[#d8d2c4]">
                      {tDesk('figures.invitationsHidden')}
                    </span>
                  ) : (
                    unread
                  )}
                </dd>
                {invited.state === 'ready' && invited.expired > 0 && (
                  <dd className="text-sm text-[#fca5a5]">
                    {tDesk('figures.expiredValue', { count: invited.expired })}
                  </dd>
                )}
              </div>
            </dl>
            <footer className="border-t border-[#f5f1e8]/15 px-5 py-3 text-sm text-[#d8d2c4]">
              {tDesk('note')}
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}
