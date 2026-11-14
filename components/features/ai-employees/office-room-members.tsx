'use client';

import type { DeskStatus } from '@/lib/features/ai-employees/office';
import type { RobotLook } from '@/lib/features/ai-employees/types/profile';
import type { AiEmployeeRole } from '@/lib/features/ai-employees/types/roles';
import { trpc } from '@/lib/trpc/client';
import { cn } from '@/lib/utils';
import { ChevronRight, Loader2 } from 'lucide-react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { CAP, FOCUS, PANEL } from './office-hud';
import { BOARD_MESSAGE, DOOR_LINK, ShelfBackButton } from './office-reception-parts';
import { ROOM_BOARD, ROOM_FRAME, RoomGuideHeader, RoomGuideLine } from './office-room-parts';
import { roomGuide } from './office-rooms';
import { invitationFigures } from './rooms/reception';

/** Members read for the shelf: the most `members.list` gives at once */
export const MEMBERS_SHELF_MAX = 100;

const ROLE_LABELS = { owner: 'roleOwner', admin: 'roleAdmin', member: 'roleMember' } as const;

/**
 * The members shelf of the reception (#1196): who belongs to the organization, and the
 * invitations that were not accepted yet. Read only (`members.list`, `members.listInvitations`):
 * inviting, revoking and roles stay on the members page of the normal view, behind the door.
 * The invitations are only shown to who may see them (admins and owners; the API decides).
 */
export function OfficeRoomMembers({
  organizationId,
  role,
  status,
  employeeName,
  look,
  onOpenNormal,
  onBack,
}: {
  organizationId: string;
  role: AiEmployeeRole;
  status: DeskStatus;
  /** The name of the AI employee of the room; null while the seat is vacant */
  employeeName: string | null;
  look?: RobotLook;
  /** A page of the normal view is opened: the office closes */
  onOpenNormal: () => void;
  /** Back to the counter */
  onBack: () => void;
}) {
  const t = useTranslations('aiOffice.immersive.room');
  const tShelf = useTranslations('aiOffice.immersive.room.reception.membersShelf');
  const tOffice = useTranslations('aiOffice');
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

  const report = members.isError
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
        <div tabIndex={-1} data-autofocus="" className="space-y-2 outline-none">
          <RoomGuideLine>
            {t(`guide.${roomGuide(status)}`, { name: employeeName ?? roleTitle, role: roleTitle })}
          </RoomGuideLine>
          <p className="text-base leading-relaxed font-medium" aria-live="polite">
            {report}
          </p>
          <p className="text-sm text-[#d8d2c4]">{tShelf('readOnly')}</p>
        </div>
        <ShelfBackButton onBack={onBack} />
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
                        <span className="block truncate text-base font-bold">
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
