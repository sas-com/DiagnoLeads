'use client';

import type { DeskStatus } from '@/lib/features/ai-employees/office';
import { AI_EMPLOYEE_ROLES, type AiEmployeeRole } from '@/lib/features/ai-employees/types/roles';
import { useTranslations } from 'next-intl';
import {
  type RefObject,
  forwardRef,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from 'react';
import {
  AREA_RECTS,
  type FloorPoint,
  OFFICE_AREAS,
  type OfficeArea,
  spotOf,
} from '../office-map-layout';
import { WorldTagButton } from '../office-world-tag';
import type { Places3D } from './office-canvas-3d';
import { type View3D, projectFloor } from './office-view-3d';

/** How far under the robot's feet its name tag hangs, in screen pixels (like the 2D floor) */
export const TAG_DROP = 12;

/** The rooms that carry their name on the floor (the corridor does not) */
export const LABELLED_AREAS = OFFICE_AREAS.filter((area) => area !== 'corridor');

/**
 * Where the name of a room floats: over the back of the room (the side away from the viewer), so
 * that it does not cover the desks or the name tags of whoever sits there.
 */
export function roomLabelAnchor(area: OfficeArea): { point: FloorPoint; height: number } {
  const rect = AREA_RECTS[area];
  return { point: { x: rect.x + rect.w * 0.3, y: rect.y + rect.h * 0.3 }, height: 2.4 };
}

/**
 * Where the name tag of a role is anchored on the floor: on the employee, wherever it stands or
 * walks right now, and on the seat while nobody was hired for it.
 */
export function tagAnchor(role: AiEmployeeRole, status: DeskStatus, places: Places3D): FloorPoint {
  const at = status === 'vacant' ? undefined : places[role];
  if (at) return at;
  const spot = spotOf(role, status);
  return { x: spot.x, y: spot.y };
}

/** What the canvas last showed: the tags place themselves with it between two frames */
export interface Shown3D {
  view: View3D;
  places: Places3D;
}

export interface Office3DTagsHandle {
  /** Puts every tag where the camera shows its employee: called by the canvas each frame */
  place: (view: View3D, places: Places3D) => void;
}

/**
 * The name tags and the room names of the 3D floor (#1147). The 3D canvas is a picture; what can
 * be chosen, pressed and read out lives here, as the same buttons the 2D floor uses. The canvas
 * tells each frame where the camera looks, and the tags are moved there without a render, so a
 * tag stays on its robot while it walks and while the floor is dragged. A tag keeps its size
 * whatever the zoom.
 */
export const Office3DTags = forwardRef<
  Office3DTagsHandle,
  {
    statuses: Readonly<Record<AiEmployeeRole, DeskStatus>>;
    /** The names of the hired employees, by role */
    names: Readonly<Partial<Record<AiEmployeeRole, string>>>;
    selected: AiEmployeeRole;
    onChoose: (role: AiEmployeeRole) => void;
    onTalk: (role: AiEmployeeRole) => void;
    /**
     * What the canvas showed in its last frame. The tags are placed with it after every render:
     * with less motion the canvas draws only on a change, so no next frame comes to place a tag
     * that was just mounted or whose seat just changed.
     */
    lastShown?: RefObject<Shown3D | null>;
  }
>(function Office3DTags({ statuses, names, selected, onChoose, onTalk, lastShown }, ref) {
  const tOffice = useTranslations('aiOffice');
  const tags = useRef<Partial<Record<AiEmployeeRole, HTMLButtonElement | null>>>({});
  const labels = useRef<Partial<Record<OfficeArea, HTMLSpanElement | null>>>({});
  // The canvas calls `place` from its own frame loop: it must read the statuses of this render
  const latest = useRef(statuses);
  latest.current = statuses;

  const place = useCallback((view: View3D, places: Places3D) => {
    for (const role of AI_EMPLOYEE_ROLES) {
      const tag = tags.current[role];
      if (!tag) continue;
      const at = projectFloor(tagAnchor(role, latest.current[role], places), 0, view);
      tag.style.transform = `translate(${at.x.toFixed(1)}px, ${(at.y + TAG_DROP).toFixed(1)}px) translate(-50%, 0)`;
      tag.style.visibility = 'visible';
    }
    for (const area of LABELLED_AREAS) {
      const label = labels.current[area];
      if (!label) continue;
      const anchor = roomLabelAnchor(area);
      const at = projectFloor(anchor.point, anchor.height, view);
      label.style.transform = `translate(${at.x.toFixed(1)}px, ${at.y.toFixed(1)}px) translate(-50%, -50%)`;
      label.style.visibility = 'visible';
    }
  }, []);
  useImperativeHandle(ref, () => ({ place }), [place]);
  // After every render, not only on a frame of the canvas (see `lastShown`)
  useLayoutEffect(() => {
    const shown = lastShown?.current;
    if (shown) place(shown.view, shown.places);
  });

  return (
    // The layer lets the pointer through to the floor under it (dragging); only the tags take it
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* The room names repeat what each tag already reads out: they are for the eye only */}
      {LABELLED_AREAS.map((area) => (
        <span
          key={area}
          ref={(node) => {
            labels.current[area] = node;
          }}
          aria-hidden="true"
          style={{ visibility: 'hidden' }}
          className="absolute top-0 left-0 rounded-full bg-[rgba(10,14,24,0.62)] px-3 py-1 text-sm font-bold whitespace-nowrap text-[#f5f1e8]"
        >
          {tOffice(`rooms.${area}`)}
        </span>
      ))}
      {AI_EMPLOYEE_ROLES.map((role) => (
        <WorldTagButton
          key={role}
          buttonRef={(node) => {
            tags.current[role] = node;
          }}
          role={role}
          status={statuses[role]}
          name={names[role] ?? null}
          chosen={role === selected}
          onChoose={() => onChoose(role)}
          onTalk={() => onTalk(role)}
          // Hidden until the canvas placed it: never a pile of tags in the corner
          style={{ top: 0, left: 0, visibility: 'hidden' }}
          className="pointer-events-auto"
        />
      ))}
    </div>
  );
});
