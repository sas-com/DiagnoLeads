'use client';

import type { DeskStatus } from '@/lib/features/ai-employees/office';
import type { RobotLook } from '@/lib/features/ai-employees/types/profile';
import type { AiEmployeeRole } from '@/lib/features/ai-employees/types/roles';
import { cn } from '@/lib/utils';
import { useId, useMemo } from 'react';
import type { SceneGradient, ScenePrim } from './office-prims';
import { ROBOT_EXTENT, robotPrims } from './office-robot';
import { FLOOR_OUTLINE } from './office-scene';

/** An id prefix of its own for the gradients and filters of one drawing */
export function useSceneIds() {
  const prefix = `office-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return { prefix, gradient: (name: SceneGradient) => `url(#${prefix}-${name})` };
}

/** The filters and gradients the primitives refer to (office-prims.ts SCENE_GRADIENTS) */
export function SceneDefs({ prefix, night }: { prefix: string; night: boolean }) {
  return (
    <defs>
      <clipPath id={`${prefix}-floor`}>
        <polygon points={FLOOR_OUTLINE} />
      </clipPath>
      <filter id={`${prefix}-soft`} x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="4" />
      </filter>
      <filter id={`${prefix}-glow`} x="-100%" y="-100%" width="300%" height="300%">
        <feGaussianBlur stdDeviation="3" />
      </filter>
      <linearGradient id={`${prefix}-sky`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={night ? '#070d22' : '#7fc4ff'} />
        <stop offset="1" stopColor={night ? '#22386a' : '#e6f4ff'} />
      </linearGradient>
      {/* By night the robots stand in lamplight: a cooler, darker shell */}
      <linearGradient id={`${prefix}-bodyOn`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor={night ? '#eef2f8' : '#ffffff'} />
        <stop offset="1" stopColor={night ? '#8f9bb0' : '#c9d1db'} />
      </linearGradient>
      <radialGradient id={`${prefix}-headOn`} cx=".35" cy=".3" r=".8">
        <stop offset="0" stopColor={night ? '#f4f7fb' : '#ffffff'} />
        <stop offset="1" stopColor={night ? '#8f9bb0' : '#c3ccd7'} />
      </radialGradient>
      <linearGradient id={`${prefix}-bodyOff`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#b8bec7" />
        <stop offset="1" stopColor="#7d8590" />
      </linearGradient>
      <radialGradient id={`${prefix}-headOff`} cx=".35" cy=".3" r=".8">
        <stop offset="0" stopColor="#c2c8d0" />
        <stop offset="1" stopColor="#7d8590" />
      </radialGradient>
      <radialGradient id={`${prefix}-pool`} cx=".5" cy=".5" r=".5">
        <stop offset="0" stopColor="#ffe0a0" stopOpacity={0.6} />
        <stop offset="0.6" stopColor="#ffd98a" stopOpacity={0.22} />
        <stop offset="1" stopColor="#ffd98a" stopOpacity={0} />
      </radialGradient>
      {/* Sunlight by day, moonlight by night: strongest at the window, fading into the room */}
      <linearGradient id={`${prefix}-sun`} x1="1" y1="0" x2="0" y2="1">
        <stop
          offset="0"
          stopColor={night ? '#a9c0ff' : '#fff6da'}
          stopOpacity={night ? 0.2 : 0.62}
        />
        <stop offset="1" stopColor={night ? '#a9c0ff' : '#fff6da'} stopOpacity={0} />
      </linearGradient>
      <linearGradient id={`${prefix}-sunSide`} x1="0" y1="0" x2="1" y2="1">
        <stop
          offset="0"
          stopColor={night ? '#a9c0ff' : '#fff6da'}
          stopOpacity={night ? 0.2 : 0.62}
        />
        <stop offset="1" stopColor={night ? '#a9c0ff' : '#fff6da'} stopOpacity={0} />
      </linearGradient>
      <radialGradient id={`${prefix}-lamp`} cx=".5" cy=".5" r=".5">
        <stop offset="0" stopColor="#fff0c2" stopOpacity={0.85} />
        <stop offset="0.45" stopColor="#ffd98a" stopOpacity={0.3} />
        <stop offset="1" stopColor="#ffd98a" stopOpacity={0} />
      </radialGradient>
      <radialGradient id={`${prefix}-sunGlow`} cx=".5" cy=".5" r=".5">
        <stop offset="0" stopColor="#fff8dc" stopOpacity={0.95} />
        <stop offset="0.35" stopColor="#fff3c4" stopOpacity={0.45} />
        <stop offset="1" stopColor="#fff3c4" stopOpacity={0} />
      </radialGradient>
    </defs>
  );
}

/** The primitives in painter's order */
export function ScenePrims({ prims, prefix }: { prims: readonly ScenePrim[]; prefix: string }) {
  return (
    <>
      {prims.map((prim, index) => {
        const key = `${prim.kind}-${index}`;
        const common = {
          fill: prim.fill,
          opacity: prim.op,
          stroke: prim.stroke,
          strokeWidth: prim.sw,
          strokeLinecap: prim.sw ? ('round' as const) : undefined,
          strokeLinejoin: prim.sw ? ('round' as const) : undefined,
          filter: prim.filter ? `url(#${prefix}-${prim.filter})` : undefined,
          clipPath: prim.clip ? `url(#${prefix}-floor)` : undefined,
          className: prim.pulse ? 'motion-safe:animate-pulse' : undefined,
        };
        switch (prim.kind) {
          case 'poly':
            return <polygon key={key} points={prim.points} {...common} />;
          case 'ellipse':
            return (
              <ellipse key={key} cx={prim.cx} cy={prim.cy} rx={prim.rx} ry={prim.ry} {...common} />
            );
          default:
            return <path key={key} d={prim.d} {...common} />;
        }
      })}
    </>
  );
}

/**
 * The robot of a role as it looks in the office, for the header of a desk's details. Decoration
 * only (aria-hidden): the name and the status are written next to it.
 */
export function RobotPortrait({
  role,
  status,
  look,
  className,
}: {
  role: AiEmployeeRole;
  status: DeskStatus;
  /** How the employee was customized (#1134); the role's own build when left out */
  look?: RobotLook;
  className?: string;
}) {
  const { prefix, gradient } = useSceneIds();
  const lookKey = JSON.stringify(look ?? null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: gradient follows prefix, look follows lookKey
  const prims = useMemo(
    () => robotPrims({ role, status, x: 0, y: 0, facing: 'left', night: false, gradient, look }),
    [role, status, lookKey, prefix]
  );
  const { left, right, top, bottom } = ROBOT_EXTENT;
  return (
    <svg
      viewBox={`${-left} ${-top} ${left + right} ${top + bottom}`}
      aria-hidden="true"
      focusable="false"
      className={cn('h-20 w-14 shrink-0', className)}
    >
      <SceneDefs prefix={prefix} night={false} />
      <ScenePrims prims={prims} prefix={prefix} />
    </svg>
  );
}
