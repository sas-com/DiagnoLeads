'use client';

import { TAP_TARGET } from '@/components/common/tap-target';
import type { DeskStatus } from '@/lib/features/ai-employees/office';
import type { OfficeEmployee } from '@/lib/features/ai-employees/service';
import { AI_EMPLOYEE_ROLES, type AiEmployeeRole } from '@/lib/features/ai-employees/types/roles';
import { cn } from '@/lib/utils';
import { UserPlus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId } from 'react';
import { DeskStatusLabel } from './desk-status';
import {
  AREA_RECTS,
  MAP_HEIGHT,
  MAP_WIDTH,
  type MapRect,
  OFFICE_AREAS,
  type OfficeArea,
  areaOf,
  spotOf,
  toPercent,
} from './office-map-layout';

/**
 * The virtual office (Refs #1101): the whole floor seen from above, with its rooms, walls, doors,
 * windows and furniture, and the AI employees as robots where their status takes them (see
 * office-map-layout.ts). Over each robot (or empty chair) a name tag is the button that opens the
 * desk; its name is its visible text plus the role, the place and today's work for screen readers.
 *
 * The drawing is decoration only (aria-hidden). Flat colours, no gradients, shadows or glows; the
 * only motion is a pulse for people who do not ask for reduced motion (decision
 * 2026-11-12-ai-employees-office).
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
  const statusOf = (role: AiEmployeeRole): DeskStatus => byRole.get(role)?.deskStatus ?? 'vacant';

  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <h2 id={headingId} className="sr-only">
        {t('floor.label')}
      </h2>
      <p className="text-sm text-gray-600 md:hidden dark:text-gray-300">{t('floor.scrollHint')}</p>
      {/* The map keeps its proportions; on a narrow screen it scrolls sideways inside its frame */}
      <div className="overflow-x-auto rounded-lg">
        <div className="relative min-w-[880px]">
          <FloorDrawing
            areaLabel={(area) => t(`rooms.${area}`)}
            statuses={Object.fromEntries(AI_EMPLOYEE_ROLES.map((role) => [role, statusOf(role)]))}
          />
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

/** The tag under a robot (or over an empty chair): the button that opens the desk */
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
  const place = t(`rooms.${areaOf(role, status)}`);
  const roleTitle = t(`roles.${role}.title`);
  const position = toPercent({ x: spot.x, y: spot.y + 24 });

  return (
    <button
      type="button"
      onClick={(event) => onOpen(event.currentTarget)}
      style={position}
      className={cn(
        TAP_TARGET,
        'absolute inline-flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-full border bg-white px-2.5 py-1 text-sm text-gray-900 hover:bg-gray-50 dark:bg-gray-900 dark:text-gray-50 dark:hover:bg-gray-800',
        status === 'vacant'
          ? 'border-dashed border-gray-500'
          : status === 'attention'
            ? 'border-2 border-[var(--color-semantic-error-1)] dark:border-red-400'
            : 'border-gray-400 dark:border-gray-500'
      )}
    >
      {/* The spaces between the parts are read as pauses; a flex box does not show them */}
      {employee ? (
        <>
          <span className="font-bold">{employee.name}</span> <DeskStatusLabel status={status} />{' '}
          <span className="sr-only">
            {t('desk.details', {
              role: roleTitle,
              place,
              count: employee.processedToday,
            })}
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

// ---------------------------------------------------------------------------------------------
// The drawing

const FLOOR: Record<OfficeArea, string> = {
  sales: 'fill-slate-100 dark:fill-slate-800',
  analysis: 'fill-emerald-50 dark:fill-emerald-950',
  planning: 'fill-amber-50 dark:fill-stone-800',
  corridor: 'fill-gray-200 dark:fill-gray-700',
  training: 'fill-sky-50 dark:fill-slate-800',
  lounge: 'fill-amber-100 dark:fill-stone-800',
  charging: 'fill-gray-100 dark:fill-gray-800',
  entrance: 'fill-stone-100 dark:fill-stone-800',
};

const WALL = 'fill-gray-500 dark:fill-gray-500';
const WINDOW = 'fill-sky-200 dark:fill-sky-800';
const DESK = 'fill-stone-300 dark:fill-stone-600';
const CHAIR = 'fill-gray-500 dark:fill-gray-600';
const LABEL = 'fill-gray-700 font-bold dark:fill-gray-200';

/** A doorway: the wall opened, and the door leaf with its swing */
function Door({
  x,
  y,
  w,
  vertical = false,
}: { x: number; y: number; w: number; vertical?: boolean }) {
  return vertical ? (
    <g>
      <rect x={x} y={y} width={10} height={w} className="fill-gray-200 dark:fill-gray-700" />
    </g>
  ) : (
    <g>
      <rect x={x} y={y} width={w} height={10} className="fill-gray-200 dark:fill-gray-700" />
      <path
        d={`M${x} ${y + 10} A${w} ${w} 0 0 1 ${x + w} ${y + 10 + w}`}
        fill="none"
        strokeWidth={1.5}
        strokeDasharray="3 3"
        className="stroke-gray-400"
      />
      <path d={`M${x} ${y + 10} v${w}`} strokeWidth={3} className="stroke-gray-500" />
    </g>
  );
}

/** A desk seen from above with its monitor; lit while its robot works */
function Desk({
  x,
  y,
  w = 80,
  h = 44,
  monitor,
  lit = false,
  dual = false,
}: {
  x: number;
  y: number;
  w?: number;
  h?: number;
  /** The edge the monitor stands on */
  monitor: 'top' | 'bottom';
  lit?: boolean;
  dual?: boolean;
}) {
  const my = monitor === 'top' ? y + 5 : y + h - 11;
  const screen = lit ? 'fill-sky-400' : 'fill-gray-700 dark:fill-gray-900';
  const ky = monitor === 'top' ? y + h - 16 : y + 8;
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={3} className={DESK} />
      {dual ? (
        <>
          <rect x={x + 10} y={my} width={28} height={6} rx={1} className={screen} />
          <rect x={x + w - 38} y={my} width={28} height={6} rx={1} className={screen} />
        </>
      ) : (
        <rect x={x + w / 2 - 18} y={my} width={36} height={6} rx={1} className={screen} />
      )}
      <rect
        x={x + w / 2 - 14}
        y={ky}
        width={28}
        height={8}
        rx={1.5}
        className="fill-gray-200 dark:fill-gray-400"
      />
    </g>
  );
}

function Chair({ cx, cy }: { cx: number; cy: number }) {
  return <circle cx={cx} cy={cy} r={13} className={CHAIR} />;
}

function Plant({ cx, cy }: { cx: number; cy: number }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={11} className="fill-orange-300 dark:fill-orange-800" />
      <g className="fill-emerald-500 dark:fill-emerald-700">
        <circle cx={cx - 6} cy={cy - 4} r={7} />
        <circle cx={cx + 6} cy={cy - 3} r={7} />
        <circle cx={cx} cy={cy + 5} r={7} />
      </g>
    </g>
  );
}

const ROBOT_BODY: Record<Exclude<DeskStatus, 'vacant'>, string> = {
  working: 'fill-white dark:fill-gray-200',
  attention: 'fill-white dark:fill-gray-200',
  idle: 'fill-white dark:fill-gray-200',
  training: 'fill-white dark:fill-gray-200',
  paused: 'fill-gray-300 dark:fill-gray-500',
};

const ROBOT_LIGHT: Record<Exclude<DeskStatus, 'vacant'>, string> = {
  working: 'fill-brand-500 motion-safe:animate-pulse',
  attention: 'fill-red-500 motion-safe:animate-pulse',
  idle: 'fill-sky-400',
  training: 'fill-amber-400',
  paused: 'fill-gray-500',
};

/** A robot seen from above: arms, round body and head, its visor towards where it faces */
function RobotFromAbove({
  x,
  y,
  facing,
  status,
}: {
  x: number;
  y: number;
  facing: number;
  status: Exclude<DeskStatus, 'vacant'>;
}) {
  const body = cn(ROBOT_BODY[status], 'stroke-gray-500 dark:stroke-gray-400');
  return (
    <g>
      <g transform={`translate(${x} ${y}) rotate(${facing})`}>
        <rect x={-26} y={-8} width={9} height={18} rx={4.5} strokeWidth={1.5} className={body} />
        <rect x={17} y={-8} width={9} height={18} rx={4.5} strokeWidth={1.5} className={body} />
        <circle r={18} strokeWidth={1.5} className={body} />
        <circle r={11} strokeWidth={1.5} className={body} />
        <rect x={-9} y={-15} width={18} height={7} rx={3.5} className="fill-gray-800" />
        {status !== 'paused' && (
          <g className={status === 'attention' ? 'fill-amber-300' : 'fill-cyan-300'}>
            <circle cx={-4} cy={-11.5} r={1.6} />
            <circle cx={4} cy={-11.5} r={1.6} />
          </g>
        )}
        {status === 'training' && (
          // A graduation cap seen from above
          <rect
            x={-9}
            y={-9}
            width={18}
            height={18}
            transform="rotate(45)"
            className="fill-gray-900 dark:fill-gray-100"
          />
        )}
        <circle r={3.5} className={ROBOT_LIGHT[status]} />
      </g>
      {status === 'attention' && (
        <g>
          <circle cx={x + 22} cy={y - 26} r={11} className="fill-red-600" />
          <rect x={x + 20.5} y={y - 33} width={3} height={9} rx={1} className="fill-white" />
          <circle cx={x + 22} cy={y - 20} r={1.7} className="fill-white" />
        </g>
      )}
      {status === 'working' && (
        // A "busy" bubble
        <g>
          <rect
            x={x + 10}
            y={y - 40}
            width={30}
            height={16}
            rx={8}
            strokeWidth={1.5}
            className="fill-white stroke-gray-400 dark:fill-gray-200"
          />
          <g className="fill-gray-500 motion-safe:animate-pulse">
            <circle cx={x + 18} cy={y - 32} r={2} />
            <circle cx={x + 25} cy={y - 32} r={2} />
            <circle cx={x + 32} cy={y - 32} r={2} />
          </g>
        </g>
      )}
      {status === 'paused' && (
        // Charging
        <path d={`M${x + 24} ${y - 34} l-7 12 h6 l-3 10 l9 -14 h-6 z`} className="fill-amber-400" />
      )}
      {status === 'idle' && (
        // A cup of coffee
        <g>
          <circle
            cx={x + 26}
            cy={y + 2}
            r={6}
            strokeWidth={1.5}
            className="fill-white stroke-gray-400 dark:fill-gray-200"
          />
          <circle cx={x + 26} cy={y + 2} r={3.5} className="fill-amber-800" />
        </g>
      )}
    </g>
  );
}

/** The floor of a room with its name */
function Room({ area, label }: { area: OfficeArea; label: string }) {
  const r: MapRect = AREA_RECTS[area];
  return (
    <g>
      <rect x={r.x} y={r.y} width={r.w} height={r.h} className={FLOOR[area]} />
      <text x={r.x + 14} y={r.y + 28} fontSize={18} className={LABEL}>
        {label}
      </text>
    </g>
  );
}

function FloorDrawing({
  areaLabel,
  statuses,
}: {
  areaLabel: (area: OfficeArea) => string;
  statuses: Record<string, DeskStatus>;
}) {
  const status = (role: AiEmployeeRole) => statuses[role] ?? 'vacant';
  const atDesk = (role: AiEmployeeRole) => {
    const s = status(role);
    return s === 'working' || s === 'attention';
  };

  return (
    <svg
      viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
      aria-hidden="true"
      focusable="false"
      className="block h-auto w-full"
    >
      {/* Outer walls; the rooms leave 10 units of wall between them */}
      <rect x={20} y={20} width={1160} height={720} rx={4} className={WALL} />
      {OFFICE_AREAS.map((area) => (
        <Room key={area} area={area} label={area === 'corridor' ? '' : areaLabel(area)} />
      ))}

      {/* Windows on the outer walls */}
      <g className={WINDOW}>
        <rect x={70} y={20} width={160} height={10} />
        <rect x={300} y={20} width={180} height={10} />
        <rect x={580} y={20} width={240} height={10} />
        <rect x={890} y={20} width={250} height={10} />
        <rect x={60} y={730} width={290} height={10} />
        <rect x={430} y={730} width={350} height={10} />
        <rect x={20} y={70} width={10} height={230} />
        <rect x={20} y={450} width={10} height={250} />
        <rect x={1170} y={60} width={10} height={240} />
      </g>

      {/* Doors to the corridor, and the entrance */}
      <Door x={250} y={330} w={50} />
      <Door x={670} y={330} w={50} />
      <Door x={990} y={330} w={50} />
      <rect x={180} y={410} width={50} height={10} className="fill-gray-200 dark:fill-gray-700" />
      <rect x={560} y={410} width={100} height={10} className="fill-gray-200 dark:fill-gray-700" />
      <rect x={875} y={410} width={50} height={10} className="fill-gray-200 dark:fill-gray-700" />
      <rect x={1060} y={410} width={50} height={10} className="fill-gray-200 dark:fill-gray-700" />
      <rect
        x={1060}
        y={730}
        width={50}
        height={10}
        className="fill-stone-100 dark:fill-stone-800"
      />
      <path d="M1060 735 h50" strokeWidth={2} strokeDasharray="6 4" className="stroke-gray-500" />

      {/* Sales floor: two islands of desks, a printer and plants */}
      <g>
        {[90, 300].map((x0) => (
          <g key={x0}>
            <Desk x={x0} y={110} monitor="bottom" />
            <Desk x={x0 + 80} y={110} monitor="bottom" />
            <Desk x={x0} y={154} monitor="top" lit={x0 === 90 && atDesk('follow_up_keeper')} />
            <Desk x={x0 + 80} y={154} monitor="top" />
            <Chair cx={x0 + 40} cy={88} />
            <Chair cx={x0 + 120} cy={88} />
            {x0 !== 90 && <Chair cx={x0 + 40} cy={222} />}
            <Chair cx={x0 + 120} cy={222} />
          </g>
        ))}
        <Chair cx={130} cy={232} />
        <rect
          x={462}
          y={262}
          width={50}
          height={36}
          rx={3}
          className="fill-gray-300 dark:fill-gray-600"
        />
        <rect x={470} y={268} width={34} height={8} rx={1} className="fill-gray-500" />
        <Plant cx={56} cy={304} />
        <Plant cx={506} cy={60} />
      </g>

      {/* Analysis room: desks with two monitors, server racks and a small round table */}
      <g>
        <Desk x={560} y={66} h={40} monitor="top" dual />
        <Desk x={670} y={66} h={40} monitor="top" dual lit={atDesk('lead_scorer')} />
        <Desk x={760} y={66} h={40} monitor="top" dual />
        <Chair cx={600} cy={128} />
        <Chair cx={710} cy={132} />
        <Chair cx={800} cy={128} />
        {[560, 606].map((x0) => (
          <g key={x0}>
            <rect
              x={x0}
              y={230}
              width={40}
              height={84}
              rx={2}
              className="fill-gray-700 dark:fill-gray-900"
            />
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <rect
                key={i}
                x={x0 + 6}
                y={238 + i * 12}
                width={28}
                height={6}
                rx={1}
                className={i % 2 === 0 ? 'fill-emerald-400' : 'fill-gray-500'}
              />
            ))}
          </g>
        ))}
        <circle cx={760} cy={250} r={24} className={DESK} />
        <Chair cx={760} cy={212} />
        <Chair cx={724} cy={268} />
        <Chair cx={796} cy={268} />
        <Plant cx={828} cy={308} />
      </g>

      {/* Planning room: a desk by the window, a whiteboard, the meeting table and sticky notes */}
      <g>
        <Desk x={885} y={66} h={40} monitor="top" lit={atDesk('timing_watcher')} />
        <Chair cx={925} cy={132} />
        <rect
          x={1000}
          y={34}
          width={150}
          height={7}
          className="fill-white stroke-gray-400 dark:fill-gray-200"
          strokeWidth={1}
        />
        <rect x={1010} y={36} width={20} height={3} className="fill-sky-500" />
        <rect x={1040} y={36} width={14} height={3} className="fill-red-500" />
        <rect x={1000} y={160} width={140} height={64} rx={30} className={DESK} />
        {[1030, 1070, 1110].map((cx) => (
          <g key={cx}>
            <Chair cx={cx} cy={142} />
            <Chair cx={cx} cy={242} />
          </g>
        ))}
        <g>
          <rect x={1158} y={120} width={10} height={14} className="fill-yellow-300" />
          <rect x={1158} y={140} width={10} height={14} className="fill-pink-300" />
          <rect x={1158} y={160} width={10} height={14} className="fill-sky-300" />
          <rect x={1158} y={180} width={10} height={14} className="fill-lime-300" />
        </g>
        <Plant cx={884} cy={306} />
      </g>

      {/* Corridor plants */}
      <Plant cx={52} cy={375} />
      <Plant cx={1148} cy={375} />

      {/* Training room: a screen, a lectern and rows of desks */}
      <g>
        <rect
          x={140}
          y={428}
          width={220}
          height={8}
          rx={2}
          className="fill-gray-800 dark:fill-gray-900"
        />
        <rect x={235} y={458} width={30} height={20} rx={2} className={DESK} />
        {[75, 170, 265].map((x0) => (
          <g key={x0}>
            <rect x={x0} y={538} width={70} height={30} rx={3} className={DESK} />
            <rect
              x={x0 + 24}
              y={546}
              width={22}
              height={14}
              rx={1}
              className="fill-white dark:fill-gray-300"
            />
            <rect x={x0} y={630} width={70} height={30} rx={3} className={DESK} />
            <Chair cx={x0 + 35} cy={680} />
            <Chair cx={x0 + 35} cy={590} />
          </g>
        ))}
      </g>

      {/* Lounge: a coffee counter, a vending machine, a sofa on a rug, a table and plants */}
      <g>
        <rect
          x={530}
          y={430}
          width={180}
          height={26}
          rx={2}
          className="fill-stone-400 dark:fill-stone-600"
        />
        <rect x={540} y={433} width={24} height={20} rx={2} className="fill-gray-800" />
        <circle cx={580} cy={443} r={5} className="fill-white dark:fill-gray-300" />
        <circle cx={594} cy={443} r={5} className="fill-white dark:fill-gray-300" />
        <rect
          x={734}
          y={430}
          width={44}
          height={30}
          rx={2}
          className="fill-red-400 dark:fill-red-700"
        />
        <rect
          x={398}
          y={500}
          width={170}
          height={190}
          rx={12}
          className="fill-teal-100 dark:fill-teal-950"
        />
        <rect
          x={400}
          y={515}
          width={32}
          height={160}
          rx={10}
          className="fill-indigo-300 dark:fill-indigo-800"
        />
        <rect
          x={432}
          y={515}
          width={8}
          height={160}
          rx={4}
          className="fill-indigo-200 dark:fill-indigo-700"
        />
        <rect x={490} y={560} width={56} height={74} rx={6} className={DESK} />
        <circle cx={700} cy={612} r={30} className={DESK} />
        <Chair cx={640} cy={612} />
        <Chair cx={760} cy={612} />
        <Chair cx={700} cy={672} />
        <Plant cx={414} cy={710} />
        <Plant cx={782} cy={710} />
      </g>

      {/* Charging station: three docks wired to the wall */}
      <g>
        {[500, 590, 680].map((cy) => (
          <g key={cy}>
            <rect
              x={868}
              y={cy - 32}
              width={64}
              height={64}
              rx={10}
              className="fill-gray-300 dark:fill-gray-600"
            />
            <path d={`M932 ${cy} H984`} strokeWidth={3} className="stroke-gray-500" />
            <rect x={976} y={cy - 8} width={10} height={16} rx={2} className="fill-amber-400" />
          </g>
        ))}
      </g>

      {/* Entrance: the reception counter, a bench, the door mat and a plant */}
      <g>
        <rect
          x={1030}
          y={470}
          width={112}
          height={30}
          rx={6}
          className="fill-stone-400 dark:fill-stone-600"
        />
        <rect x={1074} y={476} width={24} height={8} rx={1} className="fill-gray-700" />
        <rect
          x={1146}
          y={560}
          width={18}
          height={90}
          rx={4}
          className="fill-indigo-300 dark:fill-indigo-800"
        />
        <rect
          x={1055}
          y={688}
          width={60}
          height={34}
          rx={3}
          className="fill-gray-400 dark:fill-gray-600"
        />
        <Plant cx={1024} cy={706} />
      </g>

      {/* The robots, where their status takes them; an empty chair is drawn in dashes */}
      {AI_EMPLOYEE_ROLES.map((role) => {
        const s = status(role);
        const spot = spotOf(role, s);
        return s === 'vacant' ? (
          <circle
            key={role}
            cx={spot.x}
            cy={spot.y}
            r={18}
            fill="none"
            strokeWidth={2}
            strokeDasharray="5 4"
            className="stroke-gray-500"
          />
        ) : (
          <RobotFromAbove key={role} x={spot.x} y={spot.y} facing={spot.facing} status={s} />
        );
      })}
    </svg>
  );
}
