/**
 * Where the name tags and the room names of the full-screen office go on the screen (#1177), so
 * that none of them is unreadable: a name tag steps out of the way of another name tag, and the
 * name of a room steps out of the way of the panels over the floor (the HUD), of the employees
 * and their name tags, of the other room names and of the edges of the screen. The 2D floor and the 3D floor are laid
 * out by the same function.
 *
 * Pure functions, in screen pixels.
 */

export interface LabelPoint {
  x: number;
  y: number;
}

/** A rectangle on the screen, by its upper left corner */
export interface LabelBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TagToPlace {
  id: string;
  /** Where the tag hangs from: the middle of its upper edge */
  at: LabelPoint;
  w: number;
  h: number;
  /** The chosen one keeps its place; the others step aside */
  pinned?: boolean;
}

export interface RoomNameToPlace {
  id: string;
  /** Where the name may stand (its middle), the best place first */
  anchors: readonly LabelPoint[];
  w: number;
  h: number;
}

export interface PlacedLabel {
  /** The upper left corner */
  x: number;
  y: number;
  /** No free place near any of its anchors: not shown rather than unreadable */
  hidden: boolean;
}

/** The air between two name tags */
export const TAG_GAP = 4;
/** How far a name tag steps away from its employee to come out from under a panel */
export const TAG_SHIFT_MAX = 64;
/** The air around the name of a room */
export const ROOM_GAP = 8;
/** How close to the edge of the screen the name of a room may come */
export const SCREEN_MARGIN = 8;
/** How far the name of a room may move from where it belongs, before it is left out */
export const ROOM_SHIFT_MAX = 150;

function overlaps(a: LabelBox, b: LabelBox, gap: number): boolean {
  return (
    a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap
  );
}

/**
 * The name tags: each hangs under its employee. Where two would cover each other, the later one
 * moves straight up or down, whichever is nearer, so it stays under (or over) its own employee.
 * A tag also steps out from under a panel when a short step is enough; an employee who stands
 * deep under a panel keeps its tag with it. The chosen tag is placed first and never moves; the
 * others follow from the back of the floor to the front.
 */
export function placeTags(
  tags: readonly TagToPlace[],
  obstacles: readonly LabelBox[] = []
): Record<string, LabelBox> {
  const order = [...tags].sort(
    (a, b) => Number(b.pinned ?? false) - Number(a.pinned ?? false) || a.at.y - b.at.y
  );
  const placed: LabelBox[] = [];
  const result: Record<string, LabelBox> = {};
  for (const tag of order) {
    const x = tag.at.x - tag.w / 2;
    const at = (y: number): LabelBox => ({ x, y, w: tag.w, h: tag.h });
    const clearOfTags = (y: number) => placed.every((other) => !overlaps(at(y), other, TAG_GAP));
    const clearOfPanels = (y: number) =>
      obstacles.every((other) => !overlaps(at(y), other, TAG_GAP));
    const nearest = (ys: number[]) =>
      ys.sort((a, b) => Math.abs(a - tag.at.y) - Math.abs(b - tag.at.y))[0];
    const candidates = [
      tag.at.y,
      ...[...placed, ...obstacles].flatMap((other) => [
        other.y + other.h + TAG_GAP,
        other.y - tag.h - TAG_GAP,
      ]),
    ].filter(clearOfTags);
    const y = tag.pinned
      ? tag.at.y
      : (nearest(
          candidates.filter((y) => clearOfPanels(y) && Math.abs(y - tag.at.y) <= TAG_SHIFT_MAX)
        ) ??
        // Under the lowest placed tag there is always room
        nearest(candidates) ??
        tag.at.y);
    placed.push(at(y));
    result[tag.id] = at(y);
  }
  return result;
}

/**
 * The name tags and the room names of one view of the floor. The obstacles are what lies over
 * the floor (the panels, the floor guide, the action bar); name tags may pass under them, since
 * they belong to an employee, but the name of a room looks for a free place near one of its
 * anchors, and is left out when there is none.
 */
export function layoutFloorLabels({
  size,
  obstacles,
  figures = [],
  tags,
  rooms,
}: {
  size: { w: number; h: number };
  obstacles: readonly LabelBox[];
  /** The employees on the floor: a name tag hangs under one, the name of a room keeps off them */
  figures?: readonly LabelBox[];
  tags: readonly TagToPlace[];
  rooms: readonly RoomNameToPlace[];
}): { tags: Record<string, PlacedLabel>; rooms: Record<string, PlacedLabel> } {
  const tagBoxes = placeTags(tags, obstacles);
  const taken: LabelBox[] = [...obstacles, ...figures, ...Object.values(tagBoxes)];
  const inScreen = (box: LabelBox) =>
    box.x >= SCREEN_MARGIN &&
    box.y >= SCREEN_MARGIN &&
    box.x + box.w <= size.w - SCREEN_MARGIN &&
    box.y + box.h <= size.h - SCREEN_MARGIN;
  const free = (box: LabelBox) =>
    inScreen(box) && taken.every((other) => !overlaps(box, other, ROOM_GAP));

  const placedRooms: Record<string, PlacedLabel> = {};
  for (const room of rooms) {
    let found: LabelBox | null = null;
    for (const anchor of room.anchors) {
      const home = { x: anchor.x - room.w / 2, y: anchor.y - room.h / 2, w: room.w, h: room.h };
      // Back inside the screen, and then past each thing in the way, to its four sides
      const inside = {
        ...home,
        x: Math.max(SCREEN_MARGIN, Math.min(size.w - SCREEN_MARGIN - room.w, home.x)),
        y: Math.max(SCREEN_MARGIN, Math.min(size.h - SCREEN_MARGIN - room.h, home.y)),
      };
      const starts = [home, inside];
      const candidates = [
        ...starts,
        ...starts.flatMap((start) =>
          taken
            .filter((other) => overlaps(start, other, ROOM_GAP))
            .flatMap((other) => [
              { ...start, x: other.x - room.w - ROOM_GAP },
              { ...start, x: other.x + other.w + ROOM_GAP },
              { ...start, y: other.y - room.h - ROOM_GAP },
              { ...start, y: other.y + other.h + ROOM_GAP },
            ])
        ),
      ];
      const shift = (box: LabelBox) => Math.hypot(box.x - home.x, box.y - home.y);
      const best = candidates
        .filter((box) => shift(box) <= ROOM_SHIFT_MAX && free(box))
        .sort((a, b) => shift(a) - shift(b))[0];
      if (best) {
        found = best;
        break;
      }
    }
    if (found) {
      taken.push(found);
      placedRooms[room.id] = { x: found.x, y: found.y, hidden: false };
    } else {
      const anchor = room.anchors[0] ?? { x: 0, y: 0 };
      placedRooms[room.id] = { x: anchor.x - room.w / 2, y: anchor.y - room.h / 2, hidden: true };
    }
  }

  return {
    tags: Object.fromEntries(
      Object.entries(tagBoxes).map(([id, box]) => [id, { x: box.x, y: box.y, hidden: false }])
    ),
    rooms: placedRooms,
  };
}

/**
 * The panels over the floor, from the rectangles of the children of the office's layer. A child
 * that covers the screen is the floor itself or a veil over it, not something in the way; one
 * that only spans the width (a centred bar) is in the way where its own children are.
 */
export function hudObstacles(
  children: readonly { box: LabelBox; parts: readonly LabelBox[] }[],
  size: { w: number; h: number }
): LabelBox[] {
  const wide = (box: LabelBox) => box.w >= size.w * 0.9;
  const tall = (box: LabelBox) => box.h >= size.h * 0.9;
  return children
    .flatMap((child) =>
      wide(child.box) && tall(child.box) ? [] : wide(child.box) ? child.parts : [child.box]
    )
    .filter((box) => box.w > 0 && box.h > 0 && !(wide(box) && tall(box)));
}
