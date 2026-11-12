'use client';

import type { DeskStatus } from '@/lib/features/ai-employees/office';
import type { AiEmployeeRole } from '@/lib/features/ai-employees/types/roles';
import { cn } from '@/lib/utils';
import { useId, useMemo } from 'react';
import type { SceneGradient, ScenePrim } from './office-prims';
import { ROBOT_EXTENT, robotPrims } from './office-robot';

/** An id prefix of its own for the gradients and filters of one drawing */
export function useSceneIds() {
  const prefix = `office-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return { prefix, gradient: (name: SceneGradient) => `url(#${prefix}-${name})` };
}

/** The filters and gradients the primitives refer to (office-prims.ts SCENE_GRADIENTS) */
export function SceneDefs({ prefix, night }: { prefix: string; night: boolean }) {
  return (
    <defs>
      <filter id={`${prefix}-soft`} x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="4" />
      </filter>
      <filter id={`${prefix}-glow`} x="-100%" y="-100%" width="300%" height="300%">
        <feGaussianBlur stdDeviation="3" />
      </filter>
      <linearGradient id={`${prefix}-sky`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={night ? '#0b1530' : '#9fd3ff'} />
        <stop offset="1" stopColor={night ? '#27406e' : '#e9f6ff'} />
      </linearGradient>
      <linearGradient id={`${prefix}-bodyOn`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#ffffff" />
        <stop offset="1" stopColor="#c9d1db" />
      </linearGradient>
      <radialGradient id={`${prefix}-headOn`} cx=".35" cy=".3" r=".8">
        <stop offset="0" stopColor="#ffffff" />
        <stop offset="1" stopColor="#c3ccd7" />
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
        <stop offset="0" stopColor="#ffe7a3" stopOpacity={0.55} />
        <stop offset="1" stopColor="#ffe7a3" stopOpacity={0} />
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
  className,
}: {
  role: AiEmployeeRole;
  status: DeskStatus;
  className?: string;
}) {
  const { prefix, gradient } = useSceneIds();
  // biome-ignore lint/correctness/useExhaustiveDependencies: gradient follows prefix
  const prims = useMemo(
    () => robotPrims({ role, status, x: 0, y: 0, facing: 'left', night: false, gradient }),
    [role, status, prefix]
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
