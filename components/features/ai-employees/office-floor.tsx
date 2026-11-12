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
import { BarChart3, DoorOpen, Lightbulb, UserPlus, Users } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useId } from 'react';
import { DeskStatusLabel } from './desk-status';
import { RoomScene } from './office-illustration';

const ROOM_ICONS: Record<AiOfficeRoom, typeof Users> = {
  sales: Users,
  analysis: BarChart3,
  planning: Lightbulb,
};

/**
 * The office floor (Refs #1101): the building's outer wall, a room per AI_OFFICE_ROOMS separated
 * by shared walls, and in each room a desk per role drawn as a scene with the robot at work (or
 * an empty chair). Each desk is a button whose name is its visible text: the employee, the role,
 * the status and today's work, so a screen reader hears the status too.
 */
export function OfficeFloor({
  employees,
  canManage,
  onOpenDesk,
}: {
  employees: readonly OfficeEmployee[];
  canManage: boolean;
  onOpenDesk: (role: AiEmployeeRole, desk: HTMLElement) => void;
}) {
  const t = useTranslations('aiOffice');
  const headingId = useId();
  const byRole = new Map(employees.map((employee) => [employee.role, employee]));

  return (
    <section aria-labelledby={headingId} className="space-y-2">
      <h2 id={headingId} className="sr-only">
        {t('floor.label')}
      </h2>
      {/* The walls are the grey showing between the rooms */}
      <div className="overflow-hidden rounded-lg border-4 border-gray-500 bg-gray-500 dark:border-gray-500 dark:bg-gray-500">
        <div className="grid gap-1 lg:grid-cols-3">
          {AI_OFFICE_ROOMS.map((room) => (
            <OfficeRoom
              key={room}
              room={room}
              roles={rolesInRoom(room)}
              byRole={byRole}
              canManage={canManage}
              onOpenDesk={onOpenDesk}
            />
          ))}
        </div>
      </div>
      <p className="flex items-center justify-center gap-1.5 text-sm text-gray-600 dark:text-gray-300">
        <DoorOpen className="h-4 w-4" aria-hidden="true" />
        {t('floor.entrance')}
      </p>
    </section>
  );
}

function OfficeRoom({
  room,
  roles,
  byRole,
  canManage,
  onOpenDesk,
}: {
  room: AiOfficeRoom;
  roles: AiEmployeeRole[];
  byRole: ReadonlyMap<AiEmployeeRole, OfficeEmployee>;
  canManage: boolean;
  onOpenDesk: (role: AiEmployeeRole, desk: HTMLElement) => void;
}) {
  const t = useTranslations('aiOffice');
  const Icon = ROOM_ICONS[room];
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col bg-white dark:bg-gray-900">
      {/* The room's name plate on the wall */}
      <h3
        id={headingId}
        className="flex items-center gap-2 border-b border-gray-300 px-3 py-2 text-base font-bold text-gray-900 dark:border-gray-700 dark:text-gray-50"
      >
        <Icon className="h-4 w-4 text-gray-600 dark:text-gray-300" aria-hidden="true" />
        {t(`rooms.${room}`)}
      </h3>
      <ul className="grid flex-1 content-start gap-3 p-3">
        {roles.map((role) => (
          <li key={role}>
            <Desk
              room={room}
              role={role}
              employee={byRole.get(role) ?? null}
              canManage={canManage}
              onOpen={(desk) => onOpenDesk(role, desk)}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function Desk({
  room,
  role,
  employee,
  canManage,
  onOpen,
}: {
  room: AiOfficeRoom;
  role: AiEmployeeRole;
  employee: OfficeEmployee | null;
  canManage: boolean;
  onOpen: (desk: HTMLElement) => void;
}) {
  const t = useTranslations('aiOffice');
  const format = useFormatter();
  const status: DeskStatus = employee?.deskStatus ?? 'vacant';
  const roleTitle = t(`roles.${role}.title`);

  return (
    <button
      type="button"
      onClick={(event) => onOpen(event.currentTarget)}
      className={cn(
        'group block w-full overflow-hidden rounded-md border text-left hover:bg-gray-50 dark:hover:bg-gray-800/60',
        status === 'vacant'
          ? 'border-dashed border-gray-400 dark:border-gray-500'
          : status === 'attention'
            ? 'border-2 border-[var(--color-semantic-error-1)] dark:border-red-400'
            : 'border-gray-400 dark:border-gray-500'
      )}
    >
      <RoomScene room={room} status={status} />
      <span className="block space-y-1 p-3">
        <span className="block text-base font-bold text-gray-900 break-words dark:text-gray-50">
          {employee ? employee.name : roleTitle}
        </span>
        {employee && (
          <span className="block text-sm text-gray-600 dark:text-gray-300">{roleTitle}</span>
        )}
        <DeskStatusLabel status={status} />
        <span className="block text-sm text-gray-600 dark:text-gray-300">
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
          ) : canManage ? (
            <span className="inline-flex items-center gap-1 font-bold text-brand-700 underline dark:text-brand-300">
              <UserPlus className="h-4 w-4" aria-hidden="true" />
              {t('desk.hire')}
            </span>
          ) : (
            t('desk.hireByAdmin')
          )}
        </span>
        <span className="sr-only">{t('desk.openDetails')}</span>
      </span>
    </button>
  );
}
