/**
 * The robot of an AI employee seen from the front (Refs #1101), for the header of a desk's
 * details; the office map draws the same robot from above (office-map.tsx). Its look follows the
 * desk status (lit antenna while working, a graduation cap in training, a red alert when it needs
 * attention, switched off when paused, a dashed outline when vacant).
 *
 * Decoration only (aria-hidden): the status is always written next to it. Flat colours, no
 * gradients, shadows or glows; the only motion is a pulse for people who do not ask for reduced
 * motion (decision 2026-11-12-ai-employees-office).
 */
import type { DeskStatus } from '@/lib/features/ai-employees/office';
import { cn } from '@/lib/utils';

/** The light at the tip of the antenna */
const ANTENNA: Record<Exclude<DeskStatus, 'vacant'>, string> = {
  working: 'fill-brand-500 motion-safe:animate-pulse',
  attention: 'fill-red-500 motion-safe:animate-pulse',
  idle: 'fill-sky-400',
  training: 'fill-amber-400',
  paused: 'fill-gray-300 dark:fill-gray-600',
};

const BODY = 'stroke-gray-400 dark:stroke-gray-500';

function bodyFill(status: DeskStatus) {
  return status === 'paused' ? 'fill-gray-200 dark:fill-gray-500' : 'fill-white dark:fill-gray-200';
}

/** The eyes on the face screen: open, relaxed, or off */
function Eyes({ status }: { status: DeskStatus }) {
  if (status === 'paused') {
    return (
      <g className="stroke-gray-500" strokeWidth={2} strokeLinecap="round">
        <path d="M148 55 h8 M164 55 h8" />
      </g>
    );
  }
  if (status === 'idle') {
    return (
      <g className="stroke-cyan-300" strokeWidth={2.2} strokeLinecap="round" fill="none">
        <path d="M148 56 q4 -4.5 8 0 M164 56 q4 -4.5 8 0" />
      </g>
    );
  }
  const eye = status === 'attention' ? 'fill-amber-300' : 'fill-cyan-300';
  return (
    <g className={eye}>
      <circle cx={152} cy={55} r={3.5} />
      <circle cx={168} cy={55} r={3.5} />
    </g>
  );
}

/** The robot's head, antenna and what it wears; shared by the room and the avatar */
function RobotHead({ status }: { status: Exclude<DeskStatus, 'vacant'> }) {
  return (
    <g>
      <line x1={160} y1={28} x2={160} y2={38} strokeWidth={2} className="stroke-gray-400" />
      <circle cx={160} cy={25} r={4.5} className={ANTENNA[status]} />
      <rect x={131} y={50} width={6} height={12} rx={2} className="fill-gray-400" />
      <rect x={183} y={50} width={6} height={12} rx={2} className="fill-gray-400" />
      <rect
        x={136}
        y={38}
        width={48}
        height={36}
        rx={11}
        strokeWidth={1.5}
        className={cn(bodyFill(status), BODY)}
      />
      <rect
        x={142}
        y={44}
        width={36}
        height={22}
        rx={7}
        className="fill-gray-800 dark:fill-gray-900"
      />
      <Eyes status={status} />
      {status !== 'paused' && (
        <rect x={156} y={61} width={8} height={2} rx={1} className="fill-cyan-300 opacity-70" />
      )}
      {status === 'training' && (
        // A graduation cap
        <g>
          <rect x={150} y={33} width={20} height={6} className="fill-gray-900 dark:fill-gray-100" />
          <polygon
            points="160,24 184,31 160,38 136,31"
            className="fill-gray-900 dark:fill-gray-100"
          />
          <path d="M178 31 v9" strokeWidth={1.5} className="stroke-amber-400" />
          <circle cx={178} cy={41} r={2} className="fill-amber-400" />
        </g>
      )}
      {status === 'attention' && (
        // An alert bubble
        <g>
          <circle cx={198} cy={30} r={11} className="fill-red-600" />
          <rect x={196.5} y={23} width={3} height={9} rx={1} className="fill-white" />
          <circle cx={198} cy={36} r={1.7} className="fill-white" />
        </g>
      )}
    </g>
  );
}

/** The robot's head alone, for the header of the desk's details */
export function RobotAvatar({ status, className }: { status: DeskStatus; className?: string }) {
  return (
    <svg
      viewBox="126 16 80 64"
      aria-hidden="true"
      focusable="false"
      className={cn('h-14 w-[4.375rem] shrink-0', className)}
    >
      {status === 'vacant' ? (
        <rect
          x={136}
          y={38}
          width={48}
          height={36}
          rx={11}
          fill="none"
          strokeWidth={1.5}
          strokeDasharray="4 4"
          className="stroke-gray-400 dark:stroke-gray-500"
        />
      ) : (
        <RobotHead status={status} />
      )}
    </svg>
  );
}
