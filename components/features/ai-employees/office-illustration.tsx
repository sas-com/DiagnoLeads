/**
 * The drawings of the AI office (Refs #1101): a room seen from the front with its window, wall
 * decor, desk and plant, and the AI employee as a robot at the desk. The robot's look follows the
 * desk status (lit antenna while working, a graduation cap in training, a red alert when it needs
 * attention, switched off when paused, an empty chair when vacant).
 *
 * The drawings are decoration only (aria-hidden): the status is always written next to them.
 * Flat colours, no gradients, shadows or glows; the only motion is a pulse, and only for people
 * who do not ask for reduced motion (decision 2026-11-12-ai-employees-office).
 */
import type { DeskStatus } from '@/lib/features/ai-employees/office';
import type { AiOfficeRoom } from '@/lib/features/ai-employees/types/roles';
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

/** The robot from the waist up, with its hands on the desk */
function Robot({ status }: { status: Exclude<DeskStatus, 'vacant'> }) {
  return (
    <g>
      <rect x={154} y={74} width={12} height={5} className="fill-gray-400" />
      <rect
        x={132}
        y={78}
        width={56}
        height={50}
        rx={12}
        strokeWidth={1.5}
        className={cn(bodyFill(status), BODY)}
      />
      <circle
        cx={160}
        cy={90}
        r={4}
        className={status === 'paused' ? 'fill-gray-400' : 'fill-brand-500'}
      />
      <rect
        x={119}
        y={84}
        width={13}
        height={36}
        rx={6.5}
        strokeWidth={1.5}
        className={cn(bodyFill(status), BODY)}
      />
      <rect
        x={188}
        y={84}
        width={13}
        height={36}
        rx={6.5}
        strokeWidth={1.5}
        className={cn(bodyFill(status), BODY)}
      />
      <circle cx={125.5} cy={121} r={6} className="fill-gray-400" />
      <circle cx={194.5} cy={121} r={6} className="fill-gray-400" />
      <RobotHead status={status} />
    </g>
  );
}

/** What hangs on the right of the back wall, by room */
function WallDecor({ room }: { room: AiOfficeRoom }) {
  if (room === 'sales') {
    // A whiteboard with a rising bar chart
    return (
      <g>
        <rect
          x={212}
          y={24}
          width={88}
          height={58}
          rx={2}
          strokeWidth={2}
          className="fill-white stroke-gray-400 dark:fill-gray-200"
        />
        <rect x={224} y={60} width={10} height={14} className="fill-sky-400" />
        <rect x={240} y={52} width={10} height={22} className="fill-sky-400" />
        <rect x={256} y={44} width={10} height={30} className="fill-sky-500" />
        <rect x={272} y={36} width={10} height={38} className="fill-brand-500" />
        <path d="M220 74 h72" strokeWidth={1.5} className="stroke-gray-500" />
        <rect x={236} y={82} width={40} height={3} className="fill-gray-400" />
      </g>
    );
  }
  if (room === 'analysis') {
    // A wall screen with a line chart
    return (
      <g>
        <rect
          x={210}
          y={22}
          width={92}
          height={60}
          rx={3}
          className="fill-gray-800 dark:fill-gray-950"
        />
        <path
          d="M218 52 h76 M218 66 h76"
          strokeWidth={1}
          className="stroke-gray-600 dark:stroke-gray-700"
        />
        <polyline
          points="220,72 234,60 248,65 262,46 278,52 294,34"
          fill="none"
          strokeWidth={2.5}
          strokeLinejoin="round"
          className="stroke-emerald-400"
        />
        <circle cx={294} cy={34} r={3} className="fill-emerald-300" />
        <rect x={252} y={82} width={8} height={6} className="fill-gray-500" />
      </g>
    );
  }
  // planning: a calendar and sticky notes
  return (
    <g>
      <rect
        x={212}
        y={24}
        width={46}
        height={52}
        rx={2}
        strokeWidth={1.5}
        className="fill-white stroke-gray-400 dark:fill-gray-200"
      />
      <rect x={212} y={24} width={46} height={11} rx={2} className="fill-red-500" />
      <g className="fill-gray-400">
        {[0, 1, 2, 3].map((row) =>
          [0, 1, 2, 3, 4].map((col) => (
            <rect
              key={`${row}-${col}`}
              x={217 + col * 8}
              y={41 + row * 8.5}
              width={5}
              height={4}
              rx={0.5}
            />
          ))
        )}
      </g>
      <rect x={264} y={26} width={16} height={16} className="fill-yellow-200" />
      <rect x={284} y={32} width={16} height={16} className="fill-pink-200" />
      <rect x={268} y={48} width={16} height={16} className="fill-sky-200" />
      <rect x={286} y={54} width={14} height={14} className="fill-lime-200" />
    </g>
  );
}

/**
 * A room seen from the front (viewBox 320 x 200): back wall with a window and the room's decor,
 * a ceiling lamp, a cabinet and a plant, the desk with the robot (or an empty chair) behind it.
 */
export function RoomScene({
  room,
  status,
  className,
}: {
  room: AiOfficeRoom;
  status: DeskStatus;
  className?: string;
}) {
  const vacant = status === 'vacant';
  return (
    <svg
      viewBox="0 0 320 200"
      aria-hidden="true"
      focusable="false"
      className={cn('block h-auto w-full', className)}
    >
      {/* Back wall, wainscot and baseboard */}
      <rect x={0} y={0} width={320} height={140} className="fill-gray-100 dark:fill-gray-800" />
      <rect x={0} y={112} width={320} height={28} className="fill-gray-200 dark:fill-gray-700" />
      <rect x={0} y={136} width={320} height={4} className="fill-gray-300 dark:fill-gray-600" />
      {/* Wooden floor */}
      <rect x={0} y={140} width={320} height={60} className="fill-amber-100 dark:fill-stone-800" />
      <g strokeWidth={1} className="stroke-amber-200 dark:stroke-stone-700">
        <path d="M0 156 h320 M0 172 h320 M0 188 h320" />
        <path d="M60 140 v16 M180 140 v16 M290 140 v16 M20 156 v16 M130 156 v16 M250 156 v16 M80 172 v16 M210 172 v16 M40 188 v12 M160 188 v12 M280 188 v12" />
      </g>
      {/* Window with the city outside */}
      <rect x={16} y={22} width={88} height={68} rx={2} className="fill-white dark:fill-gray-600" />
      <rect x={21} y={27} width={78} height={58} className="fill-sky-100 dark:fill-slate-900" />
      <g className="fill-sky-200 dark:fill-slate-700">
        <rect x={24} y={60} width={12} height={25} />
        <rect x={38} y={50} width={14} height={35} />
        <rect x={54} y={64} width={10} height={21} />
        <rect x={66} y={44} width={12} height={41} />
        <rect x={80} y={58} width={16} height={27} />
      </g>
      <path
        d="M60 27 v58 M21 56 h78"
        strokeWidth={3}
        className="stroke-white dark:stroke-gray-600"
      />
      {/* Ceiling lamp */}
      <path d="M160 0 v9" strokeWidth={1.5} className="stroke-gray-400" />
      <path d="M147 9 h26 l6 9 h-38 z" className="fill-gray-300 dark:fill-gray-600" />
      <WallDecor room={room} />
      {/* Filing cabinet */}
      <rect
        x={18}
        y={98}
        width={42}
        height={42}
        rx={2}
        className="fill-gray-300 dark:fill-gray-600"
      />
      <path
        d="M18 112 h42 M18 126 h42"
        strokeWidth={1}
        className="stroke-gray-400 dark:stroke-gray-500"
      />
      <path d="M34 105 h10 M34 119 h10 M34 133 h10" strokeWidth={2} className="stroke-gray-500" />
      {/* Plant */}
      <g className="fill-emerald-600 dark:fill-emerald-700">
        <ellipse cx={288} cy={104} rx={6} ry={16} transform="rotate(-25 288 104)" />
        <ellipse cx={302} cy={102} rx={6} ry={17} transform="rotate(22 302 102)" />
        <ellipse cx={295} cy={98} rx={6} ry={18} />
      </g>
      <path d="M282 116 h26 l-3 24 h-20 z" className="fill-orange-300 dark:fill-orange-800" />
      {/* Chair behind the desk */}
      <rect
        x={128}
        y={vacant ? 78 : 72}
        width={64}
        height={58}
        rx={14}
        className="fill-gray-600 dark:fill-gray-900"
      />
      {vacant ? (
        // Where a robot would sit, drawn in dashes
        <g
          fill="none"
          strokeWidth={1.5}
          strokeDasharray="4 4"
          className="stroke-gray-400 dark:stroke-gray-500"
        >
          <rect x={136} y={38} width={48} height={36} rx={11} />
          <rect x={132} y={80} width={56} height={44} rx={12} />
        </g>
      ) : (
        <Robot status={status} />
      )}
      {/* Desk */}
      <rect
        x={84}
        y={122}
        width={152}
        height={7}
        rx={2}
        className="fill-stone-400 dark:fill-stone-500"
      />
      <rect x={90} y={129} width={140} height={40} className="fill-stone-300 dark:fill-stone-600" />
      <path d="M100 140 h36" strokeWidth={2} className="stroke-stone-400 dark:stroke-stone-500" />
      {/* On the desk */}
      {vacant ? (
        <rect x={140} y={118} width={40} height={4} rx={1} className="fill-gray-400" />
      ) : (
        <g>
          {/* The back of the laptop's lid */}
          <path d="M141 99 h38 l2 23 h-42 z" className="fill-gray-400 dark:fill-gray-500" />
          <circle cx={160} cy={110} r={3} className="fill-gray-200 dark:fill-gray-300" />
        </g>
      )}
      {status === 'idle' && (
        // A cup of coffee with steam
        <g>
          <rect
            x={96}
            y={108}
            width={14}
            height={14}
            rx={2}
            strokeWidth={1.5}
            className="fill-white stroke-gray-400 dark:fill-gray-200"
          />
          <path d="M110 112 q6 0 0 7" fill="none" strokeWidth={1.5} className="stroke-gray-400" />
          <path
            d="M100 104 q-3 -4 0 -8 M106 104 q-3 -4 0 -8"
            fill="none"
            strokeWidth={1.5}
            strokeLinecap="round"
            className="stroke-gray-400 motion-safe:animate-pulse"
          />
        </g>
      )}
      {status === 'training' && (
        // Books to study
        <g>
          <rect x={202} y={114} width={28} height={4} className="fill-sky-600" />
          <rect x={204} y={118} width={26} height={4} className="fill-amber-500" />
        </g>
      )}
      {status === 'working' && (
        // Papers being handled
        <g>
          <rect
            x={98}
            y={116}
            width={20}
            height={6}
            rx={1}
            className="fill-white dark:fill-gray-200"
          />
          <rect
            x={100}
            y={112}
            width={20}
            height={6}
            rx={1}
            className="fill-gray-100 dark:fill-gray-300"
          />
        </g>
      )}
    </svg>
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
