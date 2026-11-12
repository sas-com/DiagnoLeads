'use client';

import { TAP_TARGET } from '@/components/common/tap-target';
import type { DeskStatus } from '@/lib/features/ai-employees/office';
import type { OfficeEmployee } from '@/lib/features/ai-employees/service';
import { AI_EMPLOYEE_ROLES, type AiEmployeeRole } from '@/lib/features/ai-employees/types/roles';
import { cn } from '@/lib/utils';
import { UserPlus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useMemo } from 'react';
import { DeskStatusLabel } from './desk-status';
import { areaOf, spotOf } from './office-map-layout';
import { SCENE_HEIGHT, SCENE_WIDTH, buildOfficeScene, project } from './office-scene';
import { SceneDefs, ScenePrims, useSceneIds } from './office-scene-svg';

/**
 * The virtual office (Refs #1101): the whole floor in isometric projection, with its rooms, walls,
 * windows, glass partitions and furniture, and the AI employees as robots where their status takes
 * them (office-map-layout.ts). The drawing (office-scene.ts) shows the office by day in the light
 * theme (sun, blue sky, daylight on the floor) and by night in the dark theme (stars, the moon,
 * the city's lights, the lamps on). Over each robot (or empty chair) a name tag is the button that opens the
 * desk; its name is its visible text plus the role, the place and today's work for screen readers.
 *
 * The drawing is decoration only (aria-hidden). This screen alone may use gradients, shadows and
 * glows (owner decision, decision 2026-11-12-ai-employees-office); motion stays behind
 * motion-safe.
 */
export function OfficeMap({
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
  const statuses = Object.fromEntries(
    AI_EMPLOYEE_ROLES.map((role) => [role, byRole.get(role)?.deskStatus ?? 'vacant'])
  ) as Record<AiEmployeeRole, DeskStatus>;

  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <h2 id={headingId} className="sr-only">
        {t('floor.label')}
      </h2>
      <p className="text-sm text-gray-600 md:hidden dark:text-gray-300">{t('floor.scrollHint')}</p>
      {/* The map keeps its proportions; on a narrow screen it scrolls sideways inside its frame */}
      <div className="overflow-x-auto rounded-3xl">
        <div className="relative min-w-[900px] overflow-hidden rounded-3xl bg-[linear-gradient(180deg,#a9d3fb_0%,#dcecfb_45%,#f3efe8_100%)] shadow-[0_1px_2px_rgba(15,23,42,0.06),0_12px_32px_rgba(15,23,42,0.08)] dark:bg-[linear-gradient(180deg,#050915_0%,#0d1730_55%,#161d30_100%)]">
          <SceneDrawing statuses={statuses} night={false} className="dark:hidden" />
          <SceneDrawing statuses={statuses} night className="hidden dark:block" />
          {AI_EMPLOYEE_ROLES.map((role) => (
            <NameTag
              key={role}
              role={role}
              employee={byRole.get(role) ?? null}
              canManage={canManage}
              onOpen={(desk) => onOpenDesk(role, desk)}
            />
          ))}
        </div>
      </div>
      <ul className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-gray-600 dark:text-gray-300">
        <li>{t('floor.legend.desk')}</li>
        <li>{t('floor.legend.lounge')}</li>
        <li>{t('floor.legend.training')}</li>
        <li>{t('floor.legend.charging')}</li>
      </ul>
    </section>
  );
}

/** The tag under a robot (or its empty chair): the button that opens the desk */
function NameTag({
  role,
  employee,
  canManage,
  onOpen,
}: {
  role: AiEmployeeRole;
  employee: OfficeEmployee | null;
  canManage: boolean;
  onOpen: (desk: HTMLElement) => void;
}) {
  const t = useTranslations('aiOffice');
  const status: DeskStatus = employee?.deskStatus ?? 'vacant';
  const spot = spotOf(role, status);
  const [x, y] = project(spot.x, spot.y);
  const place = t(`rooms.${areaOf(role, status)}`);
  const roleTitle = t(`roles.${role}.title`);

  return (
    <button
      type="button"
      onClick={(event) => onOpen(event.currentTarget)}
      style={{
        left: `${(x / SCENE_WIDTH) * 100}%`,
        top: `${((y + 10) / SCENE_HEIGHT) * 100}%`,
      }}
      className={cn(
        TAP_TARGET,
        'absolute inline-flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-full border bg-white/95 px-3 py-1 text-sm text-gray-900 shadow-[0_6px_16px_rgba(15,23,42,0.18),0_1px_2px_rgba(15,23,42,0.12)] hover:bg-white hover:shadow-[0_10px_24px_rgba(15,23,42,0.24)] dark:bg-gray-900/95 dark:text-gray-50 dark:hover:bg-gray-900',
        status === 'vacant'
          ? 'border-dashed border-gray-500'
          : status === 'attention'
            ? 'border-2 border-[var(--color-semantic-error-1)] dark:border-red-400'
            : 'border-gray-900/10 dark:border-gray-500'
      )}
    >
      {/* The spaces between the parts are read as pauses; a flex box does not show them */}
      {employee ? (
        <>
          <span className="font-bold">{employee.name}</span> <DeskStatusLabel status={status} />{' '}
          <span className="sr-only">
            {t('desk.details', { role: roleTitle, place, count: employee.processedToday })}
          </span>
        </>
      ) : (
        <>
          <DeskStatusLabel status="vacant" /> <span className="font-bold">{roleTitle}</span>{' '}
          {canManage ? (
            <span className="inline-flex items-center gap-1 font-bold text-brand-700 underline dark:text-brand-300">
              <UserPlus className="h-4 w-4" aria-hidden="true" />
              {t('desk.hire')}
            </span>
          ) : (
            <span className="sr-only">{t('desk.hireByAdmin')}</span>
          )}{' '}
          <span className="sr-only">{t('desk.vacantDetails', { place })}</span>
        </>
      )}{' '}
      <span className="sr-only">{t('desk.openDetails')}</span>
    </button>
  );
}

/** One version of the drawing (day, or night for dark mode) with the names of the rooms */
function SceneDrawing({
  statuses,
  night,
  className,
}: {
  statuses: Record<AiEmployeeRole, DeskStatus>;
  night: boolean;
  className?: string;
}) {
  const t = useTranslations('aiOffice');
  const { prefix, gradient } = useSceneIds();
  const statusKey = AI_EMPLOYEE_ROLES.map((role) => statuses[role]).join(',');
  // biome-ignore lint/correctness/useExhaustiveDependencies: statusKey stands for statuses, prefix for gradient
  const scene = useMemo(
    () => buildOfficeScene(statuses, night, gradient),
    [statusKey, night, prefix]
  );

  return (
    <svg
      viewBox={`0 0 ${SCENE_WIDTH} ${SCENE_HEIGHT}`}
      aria-hidden="true"
      focusable="false"
      className={cn('block h-auto w-full', className)}
    >
      <SceneDefs prefix={prefix} night={night} />
      <ScenePrims prims={scene.prims} prefix={prefix} />
      {scene.labels.map((label) => {
        const text = t(`rooms.${label.area}`);
        const width = text.length * 13.5 + 18;
        // A pill hanging just below the front corner of the room's floor
        return (
          <g key={label.area}>
            <rect
              x={label.x - width / 2}
              y={label.y + 4}
              width={width}
              height={24}
              rx={12}
              fill={night ? '#0f172a' : '#ffffff'}
              opacity={0.92}
            />
            <text
              x={label.x}
              y={label.y + 21}
              textAnchor="middle"
              fill={night ? '#e5e7eb' : '#1f2937'}
              fontSize={13}
              fontWeight={700}
            >
              {text}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
