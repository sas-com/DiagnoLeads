'use client';

import type { DeskStatus } from '@/lib/features/ai-employees/office';
import type { OfficeEmployee } from '@/lib/features/ai-employees/service';
import {
  AI_OFFICE_ROOMS,
  type AiEmployeeRole,
  type AiOfficeRoom,
  rolesInRoom,
} from '@/lib/features/ai-employees/types/roles';
import { cn } from '@/lib/utils';
import { BarChart3, DoorOpen, Lightbulb, Users } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { DeskAvatar, DeskStatusLabel } from './desk-status';

const ROOM_ICONS: Record<AiOfficeRoom, typeof Users> = {
  sales: Users,
  analysis: BarChart3,
  planning: Lightbulb,
};

/**
 * The office floor (Refs #1101): the outer wall of the building, a room per AI_OFFICE_ROOMS and
 * a desk per role, the entrance at the bottom. Each desk is a button that opens its details;
 * a vacant desk is drawn with a dashed outline.
 */
export function OfficeFloor({
  employees,
  onOpenDesk,
}: {
  employees: readonly OfficeEmployee[];
  onOpenDesk: (role: AiEmployeeRole) => void;
}) {
  const t = useTranslations('aiOffice');
  const byRole = new Map(employees.map((employee) => [employee.role, employee]));

  return (
    <div className="space-y-2">
      <section
        aria-label={t('floor.label')}
        className="rounded-lg border-[3px] border-gray-500 bg-gray-50 p-2 sm:p-3 dark:border-gray-500 dark:bg-gray-950"
      >
        <div className="grid gap-2 sm:gap-3 md:grid-cols-3">
          {AI_OFFICE_ROOMS.map((room) => (
            <OfficeRoom
              key={room}
              room={room}
              roles={rolesInRoom(room)}
              byRole={byRole}
              onOpenDesk={onOpenDesk}
            />
          ))}
        </div>
      </section>
      <p className="flex items-center justify-center gap-1.5 text-sm text-gray-600 dark:text-gray-300">
        <DoorOpen className="h-4 w-4" aria-hidden="true" />
        {t('floor.entrance')}
      </p>
    </div>
  );
}

function OfficeRoom({
  room,
  roles,
  byRole,
  onOpenDesk,
}: {
  room: AiOfficeRoom;
  roles: AiEmployeeRole[];
  byRole: ReadonlyMap<AiEmployeeRole, OfficeEmployee>;
  onOpenDesk: (role: AiEmployeeRole) => void;
}) {
  const t = useTranslations('aiOffice');
  const Icon = ROOM_ICONS[room];
  const headingId = `ai-office-room-${room}`;
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col rounded-md border-2 md:min-h-56 border-gray-300 bg-white dark:border-gray-700 dark:bg-gray-900"
    >
      {/* The room's name plate on the wall */}
      <h3
        id={headingId}
        className="flex items-center gap-2 border-b-2 border-gray-300 px-3 py-2 text-base font-bold text-gray-900 dark:border-gray-700 dark:text-gray-50"
      >
        <Icon className="h-4 w-4 text-gray-600 dark:text-gray-300" aria-hidden="true" />
        {t(`rooms.${room}`)}
      </h3>
      <ul className="grid flex-1 content-start gap-3 p-3">
        {roles.map((role) => (
          <li key={role}>
            <Desk role={role} employee={byRole.get(role) ?? null} onOpen={() => onOpenDesk(role)} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function Desk({
  role,
  employee,
  onOpen,
}: {
  role: AiEmployeeRole;
  employee: OfficeEmployee | null;
  onOpen: () => void;
}) {
  const t = useTranslations('aiOffice');
  const format = useFormatter();
  const status: DeskStatus = employee?.deskStatus ?? 'vacant';
  const roleTitle = t(`roles.${role}.title`);
  const label = employee
    ? t('desk.open', { name: employee.name, role: roleTitle })
    : t('desk.openVacant', { role: roleTitle });

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={label}
      className={cn(
        'w-full min-h-11 rounded-md border p-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800/60',
        status === 'vacant'
          ? 'border-dashed border-gray-400 dark:border-gray-600'
          : status === 'attention'
            ? 'border-[var(--color-semantic-error-1)] dark:border-red-400'
            : 'border-gray-300 dark:border-gray-700'
      )}
    >
      <span className="flex items-start gap-3">
        <DeskAvatar role={role} status={status} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-base font-bold text-gray-900 dark:text-gray-50">
            {employee ? employee.name : roleTitle}
          </span>
          {employee && (
            <span className="block text-sm text-gray-600 dark:text-gray-300">{roleTitle}</span>
          )}
          <DeskStatusLabel status={status} className="mt-1" />
        </span>
      </span>
      {/* The desk top under the person */}
      <span
        aria-hidden="true"
        className={cn(
          'mt-3 block h-2 rounded-sm',
          status === 'vacant' ? 'bg-gray-200 dark:bg-gray-800' : 'bg-gray-300 dark:bg-gray-700'
        )}
      />
      <span className="mt-2 block text-sm text-gray-600 dark:text-gray-300">
        {employee ? (
          <>
            {t('desk.processedToday', { count: employee.processedToday })}
            {' · '}
            {employee.lastRun
              ? t('desk.lastRun', {
                  time: format.dateTime(new Date(employee.lastRun.startedAt), {
                    month: 'numeric',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  }),
                })
              : t('desk.noRun')}
          </>
        ) : (
          t('statusHint.vacant')
        )}
      </span>
    </button>
  );
}
