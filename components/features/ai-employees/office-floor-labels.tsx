'use client';

import type { DeskStatus } from '@/lib/features/ai-employees/office';
import { AI_EMPLOYEE_ROLES, type AiEmployeeRole } from '@/lib/features/ai-employees/types/roles';
import { cn } from '@/lib/utils';
import { useTranslations } from 'next-intl';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from 'react';
import { type LabelBox, hudObstacles, layoutFloorLabels } from './office-label-layout';
import {
  AREA_RECTS,
  type FloorPoint,
  OFFICE_AREAS,
  type OfficeArea,
  spotOf,
} from './office-map-layout';
import { SCENE_WIDTH, project } from './office-scene';
import { WorldTagButton } from './office-world-tag';

/** How far under the robot's feet its name tag hangs, in screen pixels */
export const TAG_DROP = 12;

/** How tall a robot stands, in floor units: the name of a room keeps off it */
export const FIGURE_HEIGHT = 3;
/** The robots of the 3D floor are built smaller than the drawn ones */
export const FIGURE_HEIGHT_3D = 2.5;

/** The mark over the chosen employee: how far over its head, and its size on the screen */
const MARKER_LIFT = 0.35;
const MARKER_SIZE = { w: 22, h: 14 };

/** The rooms that carry their name on the floor (the corridor does not) */
export const LABELLED_AREAS = OFFICE_AREAS.filter((area) => area !== 'corridor');

/** How long the 2D floor glides to a new view: its name tags glide with it */
const GLIDE = 'transform 700ms cubic-bezier(0, 0, 0.2, 1)';

/** Where every employee stands right now, by role (the 3D floor: they walk) */
export type FloorPlaces = Partial<Record<AiEmployeeRole, FloorPoint>>;

/** Where a place on the floor, and a height over it in floor units, lands on the screen */
export type FloorProjector = (point: FloorPoint, height: number) => { x: number; y: number };

export interface LabelAnchor {
  point: FloorPoint;
  height: number;
}

/**
 * Where the name of a room may stand, the best place first: floating over the back of the room
 * (the side away from the viewer, clear of the desks and of whoever sits there), then on the
 * middle of its floor, then near its front. The layout takes the first one with a free place.
 */
export function roomLabelAnchors(area: OfficeArea): LabelAnchor[] {
  const rect = AREA_RECTS[area];
  const at = (x: number, y: number, height: number): LabelAnchor => ({
    point: { x: rect.x + rect.w * x, y: rect.y + rect.h * y },
    height,
  });
  return [at(0.3, 0.3, 2.4), at(0.5, 0.5, 0), at(0.5, 0.85, 0)];
}

/** The place the name of a room is drawn to first */
export function roomLabelAnchor(area: OfficeArea): LabelAnchor {
  return roomLabelAnchors(area)[0];
}

/**
 * Where the name tag of a role is anchored on the floor: on the employee, wherever it stands or
 * walks right now, and on the seat while nobody was hired for it.
 */
export function tagAnchor(
  role: AiEmployeeRole,
  status: DeskStatus,
  places: FloorPlaces
): FloorPoint {
  const at = status === 'vacant' ? undefined : places[role];
  if (at) return at;
  const spot = spotOf(role, status);
  return { x: spot.x, y: spot.y };
}

export interface FloorLabelsHandle {
  /**
   * Puts every name tag and room name where the floor shows what it names. `glide` lets them
   * move there over the time the 2D floor takes; without it they are there at once
   */
  place: (
    project: FloorProjector,
    places: FloorPlaces,
    size: { w: number; h: number },
    glide?: boolean
  ) => void;
}

export interface FloorLabelsProps {
  statuses: Readonly<Record<AiEmployeeRole, DeskStatus>>;
  /** The names of the hired employees, by role */
  names: Readonly<Partial<Record<AiEmployeeRole, string>>>;
  selected: AiEmployeeRole;
  onChoose: (role: AiEmployeeRole) => void;
  onTalk: (role: AiEmployeeRole) => void;
}

const boxOf = (rect: DOMRect, origin: { left: number; top: number }): LabelBox => ({
  x: rect.left - origin.left,
  y: rect.top - origin.top,
  w: rect.width,
  h: rect.height,
});

/**
 * The name tags and the room names over the floor of the full-screen office, in 2D and in 3D
 * (#1147, #1177). The floor is a picture; what can be chosen, pressed and read out lives here,
 * as DOM over it. Whoever draws the floor says where things are (`place`), and this layer lays
 * the tags and names out so that none covers another or hides under a panel
 * (office-label-layout.ts). They are moved without a render, so a tag stays on its robot while
 * it walks and while the floor is dragged, and they keep their size whatever the zoom.
 */
export const OfficeFloorLabels = forwardRef<
  FloorLabelsHandle,
  FloorLabelsProps & {
    /** How tall the robots of this floor stand, in floor units */
    figureHeight?: number;
    /** After every render and every resize, once measured: the owner places the labels again */
    onLayout?: () => void;
    className?: string;
  }
>(function OfficeFloorLabels(
  {
    statuses,
    names,
    selected,
    onChoose,
    onTalk,
    figureHeight = FIGURE_HEIGHT,
    onLayout,
    className,
  },
  ref
) {
  const tOffice = useTranslations('aiOffice');
  const layer = useRef<HTMLDivElement>(null);
  const tags = useRef<Partial<Record<AiEmployeeRole, HTMLButtonElement | null>>>({});
  const labels = useRef<Partial<Record<OfficeArea, HTMLSpanElement | null>>>({});
  // What `place` needs and a frame must not measure: the sizes of the labels and the panels
  // (a role and a room may share a name: two lists)
  const tagSizes = useRef<Partial<Record<AiEmployeeRole, { w: number; h: number }>>>({});
  const nameSizes = useRef<Partial<Record<OfficeArea, { w: number; h: number }>>>({});
  const hud = useRef<{ box: LabelBox; parts: LabelBox[] }[]>([]);
  const marker = useRef<HTMLSpanElement>(null);
  // `place` is called from a frame loop: it must read the statuses of this render
  const latest = useRef({ statuses, selected, figureHeight });
  latest.current = { statuses, selected, figureHeight };

  const measure = useCallback(() => {
    for (const role of AI_EMPLOYEE_ROLES) {
      const tag = tags.current[role];
      if (tag) tagSizes.current[role] = { w: tag.offsetWidth, h: tag.offsetHeight };
    }
    for (const area of LABELLED_AREAS) {
      const label = labels.current[area];
      if (label) nameSizes.current[area] = { w: label.offsetWidth, h: label.offsetHeight };
    }
    // The panels are the other children of the office's layer: nothing has to register itself
    const root = layer.current?.parentElement;
    if (!root) return;
    const origin = root.getBoundingClientRect();
    hud.current = Array.from(root.children)
      .filter((child) => child !== layer.current)
      .map((child) => ({
        box: boxOf(child.getBoundingClientRect(), origin),
        parts: Array.from(child.children).map((part) =>
          boxOf(part.getBoundingClientRect(), origin)
        ),
      }));
  }, []);

  const place = useCallback<FloorLabelsHandle['place']>((toScreen, places, size, glide = false) => {
    const unmeasured = { w: 0, h: 0 };
    const laid = layoutFloorLabels({
      size,
      obstacles: hudObstacles(hud.current, size),
      // The name of a room does not stand on somebody's face either
      figures: AI_EMPLOYEE_ROLES.flatMap((role) => {
        const status = latest.current.statuses[role];
        const chosen = role === latest.current.selected;
        if (status === 'vacant' && !chosen) return [];
        const on = tagAnchor(role, status, places);
        const feet = toScreen(on, 0);
        const head = toScreen(on, latest.current.figureHeight);
        const tall = feet.y - head.y;
        // The chosen one carries its mark over the head
        const top = chosen
          ? toScreen(on, latest.current.figureHeight + MARKER_LIFT).y - MARKER_SIZE.h
          : head.y;
        return [{ x: feet.x - tall * 0.3, y: top, w: tall * 0.6, h: feet.y - top }];
      }),
      tags: AI_EMPLOYEE_ROLES.flatMap((role) => {
        if (!tags.current[role]) return [];
        const at = toScreen(tagAnchor(role, latest.current.statuses[role], places), 0);
        return [
          {
            id: role,
            at: { x: at.x, y: at.y + TAG_DROP },
            ...(tagSizes.current[role] ?? unmeasured),
            pinned: role === latest.current.selected,
          },
        ];
      }),
      rooms: LABELLED_AREAS.flatMap((area) =>
        labels.current[area]
          ? [
              {
                id: area,
                anchors: roomLabelAnchors(area).map((anchor) =>
                  toScreen(anchor.point, anchor.height)
                ),
                ...(nameSizes.current[area] ?? unmeasured),
              },
            ]
          : []
      ),
    });
    const put = (node: HTMLElement, at: { x: number; y: number; hidden: boolean }) => {
      // Never a glide from the corner: the first place is taken at once
      node.style.transition = glide && node.dataset.placed ? GLIDE : 'none';
      node.style.transform = `translate(${at.x.toFixed(1)}px, ${at.y.toFixed(1)}px)`;
      node.style.visibility = at.hidden ? 'hidden' : 'visible';
      node.dataset.placed = 'true';
    };
    for (const role of AI_EMPLOYEE_ROLES) {
      const tag = tags.current[role];
      if (tag) put(tag, laid.tags[role]);
    }
    // The mark over the head of the chosen one (or over the empty seat that was chosen)
    if (marker.current) {
      const chosen = latest.current.selected;
      const over = toScreen(
        tagAnchor(chosen, latest.current.statuses[chosen], places),
        latest.current.figureHeight + MARKER_LIFT
      );
      put(marker.current, {
        x: over.x - MARKER_SIZE.w / 2,
        y: over.y - MARKER_SIZE.h,
        hidden: false,
      });
    }
    for (const area of LABELLED_AREAS) {
      const label = labels.current[area];
      if (label) put(label, laid.rooms[area]);
    }
  }, []);
  useImperativeHandle(ref, () => ({ place }), [place]);

  // After every render, not only on a frame of the floor: with less motion no frame follows
  useLayoutEffect(() => {
    measure();
    onLayout?.();
  });
  const again = useRef(onLayout);
  again.current = onLayout;
  useEffect(() => {
    const onResize = () => {
      measure();
      again.current?.();
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [measure]);

  return (
    // The layer lets the pointer through to the floor under it (dragging); only the tags take it
    <div
      ref={layer}
      data-office-labels=""
      // Its own stacking order: the chosen tag rises over the other tags, never over a panel
      className={cn('pointer-events-none absolute inset-0 isolate overflow-hidden', className)}
    >
      {/* The room names repeat what each tag already reads out: they are for the eye only */}
      {LABELLED_AREAS.map((area) => (
        <span
          key={area}
          ref={(node) => {
            labels.current[area] = node;
          }}
          aria-hidden="true"
          style={{ visibility: 'hidden' }}
          className="absolute top-0 left-0 rounded-full border border-[#e9cf9a]/35 bg-[rgba(10,14,24,0.72)] px-3 py-1 text-sm font-bold tracking-wider whitespace-nowrap text-[#f5f1e8]"
        >
          {tOffice(`rooms.${area}`)}
        </span>
      ))}
      {/* Who is chosen shows on the floor too, not only in the border of a name tag (#1183).
          For the eye only: the tag says it to a screen reader (aria-current) */}
      <span
        ref={marker}
        aria-hidden="true"
        data-chosen-marker=""
        style={{ visibility: 'hidden', width: MARKER_SIZE.w, height: MARKER_SIZE.h }}
        className="absolute top-0 left-0 bg-[#e9cf9a] drop-shadow-[0_2px_4px_rgba(4,8,18,0.8)] [clip-path:polygon(0_0,100%_0,50%_100%)]"
      />
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
          // Hidden until it was placed: never a pile of tags in the corner
          style={{ top: 0, left: 0, visibility: 'hidden' }}
          // The chosen one lies over the others where the floor is crowded
          className={cn('pointer-events-auto', role === selected && 'z-10')}
        />
      ))}
    </div>
  );
});

/**
 * The name tags and the room names of the 2D floor. The drawing is moved and scaled as one
 * picture (`camera`, `scale`); the labels are placed over it from the same numbers, and glide
 * with it when the view changes.
 */
export function OfficeTags2D({
  camera,
  scale,
  width,
  size,
  glide,
  ...labels
}: FloorLabelsProps & {
  /** Where the upper left corner of the drawing is on the screen */
  camera: { x: number; y: number };
  scale: number;
  /** The width of the drawing before it is scaled, in pixels */
  width: number;
  size: { w: number; h: number };
  /** Whether the floor glides to its view right now (not while it is dragged) */
  glide: boolean;
}) {
  const ref = useRef<FloorLabelsHandle>(null);
  const perUnit = (width * scale) / SCENE_WIDTH;
  return (
    <OfficeFloorLabels
      ref={ref}
      {...labels}
      // The floor glides in from the title: the labels wait for it instead of jumping ahead
      className="motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-700"
      onLayout={() =>
        ref.current?.place(
          (point, height) => {
            const [x, y] = project(point.x, point.y, height);
            return { x: camera.x + x * perUnit, y: camera.y + y * perUnit };
          },
          {},
          size,
          glide
        )
      }
    />
  );
}
