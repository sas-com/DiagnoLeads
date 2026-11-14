'use client';

import { isImeKey } from '@/components/ui/ime';
import { Input } from '@/components/ui/input';
import type { DeskStatus } from '@/lib/features/ai-employees/office';
import type { RobotLook } from '@/lib/features/ai-employees/types/profile';
import type { AiEmployeeRole } from '@/lib/features/ai-employees/types/roles';
import { trpc } from '@/lib/trpc/client';
import { cn } from '@/lib/utils';
import { AlertTriangle, ChevronRight, Loader2 } from 'lucide-react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { type FormEvent, type MutableRefObject, useEffect, useId, useRef, useState } from 'react';
import { CAP, FOCUS, PANEL } from './office-hud';
import { BOARD_MESSAGE, DOOR_LINK, ShelfBackButton } from './office-reception-parts';
import type { RoomKeys } from './office-room-contract';
import {
  ROOM_BOARD,
  ROOM_FRAME,
  RoomChoiceButton,
  RoomGuideHeader,
  RoomGuideLine,
} from './office-room-parts';
import { roomGuide } from './office-rooms';
import { FIELD } from './office-talk-staff';
import { REVOKE_KEY, invitationFigures, invitationNamed } from './rooms/reception';

/** Members read for the shelf: the most `members.list` gives at once */
export const MEMBERS_SHELF_MAX = 100;

const ROLE_LABELS = { owner: 'roleOwner', admin: 'roleAdmin', member: 'roleMember' } as const;

/**
 * The members shelf of the reception (#1196): who belongs to the organization, and the
 * invitations that were not accepted yet (`members.list`, `members.listInvitations`). The
 * invitations are only shown to who may see them (admins and owners; the API decides).
 *
 * The one thing done here is revoking a pending invitation (#1197, `members.revokeInvitation`).
 * Its key only opens a field; the invitation is revoked once the address of the invited person
 * was typed, so the keys of the choices alone never reach it. While it is being saved there is no
 * way back: Esc would look like giving it up, and the request is already on its way. Inviting,
 * roles and removing a member stay on the members page of the normal view, behind the door: an
 * invitation typed with keys alone would let the one who chose the keys choose who joins (owner's
 * decision, 2026-11-14).
 */
export function OfficeRoomMembers({
  organizationId,
  role,
  status,
  employeeName,
  look,
  keysRef,
  onOpenNormal,
  onBack,
}: {
  organizationId: string;
  role: AiEmployeeRole;
  status: DeskStatus;
  /** The name of the AI employee of the room; null while the seat is vacant */
  employeeName: string | null;
  look?: RobotLook;
  /** Filled with the shelf's key handler while the shelf is shown */
  keysRef: MutableRefObject<RoomKeys | null>;
  /** A page of the normal view is opened: the office closes */
  onOpenNormal: () => void;
  /** Back to the counter */
  onBack: () => void;
}) {
  const t = useTranslations('aiOffice.immersive.room');
  const tShelf = useTranslations('aiOffice.immersive.room.reception.membersShelf');
  const tOffice = useTranslations('aiOffice');
  const tImmersive = useTranslations('aiOffice.immersive');
  const tMembers = useTranslations('settings.members');
  const locale = useLocale();
  const format = useFormatter();
  const roleTitle = tOffice(`roles.${role}.title`);

  const members = trpc.members.list.useQuery({
    organizationId,
    limit: MEMBERS_SHELF_MAX,
    offset: 0,
  });
  const invitations = trpc.members.listInvitations.useQuery({ organizationId });
  const invited = invitationFigures(
    invitations.data,
    invitations.isError
      ? invitations.error?.data?.code === 'FORBIDDEN'
        ? 'forbidden'
        : 'error'
      : null
  );
  const roleLabel = (value: string) =>
    value in ROLE_LABELS ? tMembers(ROLE_LABELS[value as keyof typeof ROLE_LABELS]) : value;
  const day = (value: Date | string) =>
    format.dateTime(new Date(value), { year: 'numeric', month: '2-digit', day: '2-digit' });

  const utils = trpc.useUtils();
  const reportRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLInputElement>(null);
  const fieldId = useId();
  const noteId = useId();
  // The field of the revoking, open or not; what was typed in it; and what came of it
  const [revoking, setRevoking] = useState(false);
  const [typed, setTyped] = useState('');
  const [refused, setRefused] = useState(false);
  const [outcome, setOutcome] = useState<
    { kind: 'done'; email: string } | { kind: 'gone' | 'failed' } | null
  >(null);
  const revoke = trpc.members.revokeInvitation.useMutation({
    // Read again whatever came of it, and even when the shelf was left meanwhile: the counter
    // reads the same list, and its figure follows
    onSettled: () => void utils.members.listInvitations.invalidate({ organizationId }),
  });
  const pending = invitations.data ?? [];
  // Revoking is offered only to who may see the invitations, and open while there is one
  const mayRevoke = invited.state === 'ready';
  const canOpen = mayRevoke && pending.length > 0;
  const named = invitationNamed(typed, pending);
  const busy = revoke.isPending;

  const close = () => {
    setRevoking(false);
    setTyped('');
    setRefused(false);
  };
  const open = () => {
    if (!canOpen) return;
    setOutcome(null);
    setRevoking(true);
  };
  // The field takes the focus when it opens; what came of it is read where the report is
  useEffect(() => {
    if (revoking) fieldRef.current?.focus();
  }, [revoking]);
  const carryOut = (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (!named) {
      setRefused(true);
      return;
    }
    revoke.mutate(
      { organizationId, invitationId: named.id },
      {
        onSuccess: () => setOutcome({ kind: 'done', email: named.email }),
        // Told by its code, never by the server's own words
        onError: (error) =>
          setOutcome({ kind: error.data?.code === 'NOT_FOUND' ? 'gone' : 'failed' }),
        onSettled: () => {
          close();
          reportRef.current?.focus();
        },
      }
    );
  };

  // The shelf's keys: the number only opens the field. While it is open every key belongs to what
  // is typed, except Esc, which closes the field and not the shelf; while saving, Esc does nothing.
  const onShelfKey: RoomKeys = (event) => {
    // A key of a Japanese conversion (IME) belongs to what is being typed
    if (isImeKey(event)) return false;
    if (revoking) {
      if (event.key !== 'Escape') return false;
      event.preventDefault();
      if (!busy) {
        close();
        reportRef.current?.focus();
      }
      return true;
    }
    if (event.key !== REVOKE_KEY || !mayRevoke) return false;
    event.preventDefault();
    open();
    return true;
  };
  const latestKeys = useRef(onShelfKey);
  latestKeys.current = onShelfKey;
  useEffect(() => {
    keysRef.current = (event) => latestKeys.current(event);
    return () => {
      keysRef.current = null;
    };
  }, [keysRef]);

  const report =
    outcome?.kind === 'done'
      ? tShelf('revoke.done', { email: outcome.email })
      : outcome
        ? tShelf(`revoke.${outcome.kind}`)
        : members.isError
          ? tShelf('error')
          : !members.data
            ? tShelf('reading')
            : invited.state === 'ready'
              ? tShelf('reportWithInvitations', {
                  count: members.data.total,
                  waiting: invited.waiting,
                })
              : tShelf('report', { count: members.data.total });
  const more = members.data ? members.data.total - members.data.members.length : 0;

  return (
    <div className={ROOM_FRAME}>
      <div className={cn(PANEL, 'shrink-0 space-y-3 px-5 pt-4 pb-6 lg:w-[26rem]')}>
        <RoomGuideHeader role={role} status={status} employeeName={employeeName} look={look} />
        <div ref={reportRef} tabIndex={-1} data-autofocus="" className="space-y-2 outline-none">
          <RoomGuideLine>
            {t(`guide.${roomGuide(status)}`, { name: employeeName ?? roleTitle, role: roleTitle })}
          </RoomGuideLine>
          <p className="text-base leading-relaxed font-medium" aria-live="polite">
            {report}
          </p>
          <p className="text-sm text-[#d8d2c4]">{tShelf('readOnly')}</p>
        </div>
        {revoking ? (
          // The room says what is wrong in its own words: the browser's own check would only hold
          // the form back without a word read out
          <form onSubmit={carryOut} noValidate className="flex flex-col gap-2">
            <h3 className={CAP}>{tShelf('revoke.title')}</h3>
            <p id={noteId} className="text-sm leading-relaxed">
              {tShelf('revoke.note')}
            </p>
            <label htmlFor={fieldId} className="text-sm text-[#d8d2c4]">
              {tShelf('revoke.label')}
            </label>
            <Input
              ref={fieldRef}
              id={fieldId}
              // Not an email field: a browser may offer addresses it remembers for one, and the
              // address has to be typed
              type="text"
              inputMode="email"
              autoCapitalize="none"
              spellCheck={false}
              value={typed}
              maxLength={320}
              autoComplete="off"
              aria-describedby={noteId}
              onChange={(event) => {
                setTyped(event.target.value);
                setRefused(false);
              }}
              className={FIELD}
            />
            {refused && !named && (
              <p role="alert" className="text-sm font-bold text-[#fca5a5]">
                <AlertTriangle className="mr-1.5 inline h-4 w-4 align-[-2px]" aria-hidden="true" />
                {tShelf('revoke.mismatch')}
              </p>
            )}
            <button
              type="submit"
              aria-disabled={!named || busy}
              className={cn(
                'flex min-h-12 w-full items-center justify-center gap-2 border px-4 text-base font-bold',
                // Closed until the address was typed: an outline only, so it does not read as ready
                named
                  ? 'border-[#fca5a5] bg-[#7f1d1d] text-white hover:bg-[#991b1b] aria-disabled:opacity-60'
                  : 'cursor-not-allowed border-[#fca5a5]/50 bg-transparent text-[#fca5a5]/70',
                FOCUS
              )}
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {tShelf('revoke.confirm')}
            </button>
            <ShelfBackButton onBack={close} closed={busy} label={tShelf('revoke.back')} />
          </form>
        ) : (
          <>
            {mayRevoke && (
              <>
                <h3 className={CAP}>{tImmersive('talk.you')}</h3>
                <RoomChoiceButton keyCap={REVOKE_KEY} closed={!canOpen} onClick={open}>
                  {tShelf('revoke.choice')}
                </RoomChoiceButton>
              </>
            )}
            <ShelfBackButton onBack={onBack} />
          </>
        )}
      </div>

      <section
        aria-label={tShelf('board')}
        aria-busy={members.isFetching || invitations.isFetching}
        className={ROOM_BOARD}
      >
        <header className="border-b border-[#f5f1e8]/15 px-5 pt-4 pb-3">
          <h2 className="text-xl font-bold">{tShelf('board')}</h2>
        </header>

        {members.isError ? (
          <p className={BOARD_MESSAGE}>{tShelf('error')}</p>
        ) : !members.data ? (
          <output className="m-auto flex items-center gap-3 text-sm text-[#d8d2c4]">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
            {tShelf('reading')}
          </output>
        ) : (
          <div className="grid min-h-0 flex-1 content-start gap-x-8 gap-y-6 overflow-y-auto px-5 py-5 md:grid-cols-2">
            <div className="min-w-0 space-y-3">
              <h3 className={CAP}>{tShelf('members', { count: members.data.total })}</h3>
              <ul className="space-y-1">
                {members.data.members.map((member) => (
                  <li
                    key={member.id}
                    className="flex items-start justify-between gap-3 border-b border-[#f5f1e8]/10 py-2 text-sm"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-base font-bold">
                        {member.user.name || member.user.email}
                      </span>
                      {member.user.name && (
                        <span className="block truncate text-xs text-[#d8d2c4]">
                          {member.user.email}
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 rounded-full border border-[#d8d2c4] px-2.5 py-0.5 text-xs text-[#d8d2c4]">
                      {roleLabel(member.role)}
                    </span>
                  </li>
                ))}
              </ul>
              {more > 0 && (
                <p className="text-sm text-[#d8d2c4]">{tShelf('more', { count: more })}</p>
              )}
            </div>

            <div className="min-w-0 space-y-3">
              <h3 className={CAP}>{tShelf('invitations')}</h3>
              {invited.state === 'hidden' ? (
                <p className="text-sm text-[#d8d2c4]">{tShelf('invitationsHidden')}</p>
              ) : invited.state === 'error' ? (
                <p className="text-sm text-[#d8d2c4]">{tShelf('invitationsError')}</p>
              ) : !invitations.data ? (
                <p className="text-sm text-[#d8d2c4]">{tShelf('reading')}</p>
              ) : invitations.data.length === 0 ? (
                <p className="text-sm text-[#d8d2c4]">{tShelf('noInvitations')}</p>
              ) : (
                <ul className="space-y-1">
                  {invitations.data.map((invitation) => (
                    <li
                      key={invitation.id}
                      className="flex items-start justify-between gap-3 border-b border-[#f5f1e8]/10 py-2 text-sm"
                    >
                      <span className="min-w-0">
                        <span className="block text-base font-bold break-all">
                          {invitation.email}
                        </span>
                        <span
                          className={cn(
                            'block text-xs',
                            invitation.expired ? 'text-[#fca5a5]' : 'text-[#d8d2c4]'
                          )}
                        >
                          {invitation.expired
                            ? tShelf('expired')
                            : tShelf('expires', { date: day(invitation.expiresAt) })}
                        </span>
                      </span>
                      <span className="shrink-0 rounded-full border border-[#d8d2c4] px-2.5 py-0.5 text-xs text-[#d8d2c4]">
                        {roleLabel(invitation.role)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        <footer className="flex flex-wrap items-center justify-end gap-3 border-t border-[#f5f1e8]/15 px-5 py-3 text-sm text-[#d8d2c4]">
          <Link
            href={`/${locale}/settings/members`}
            onClick={onOpenNormal}
            className={cn(DOOR_LINK, FOCUS)}
          >
            {tShelf('open')}
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </footer>
      </section>
    </div>
  );
}
