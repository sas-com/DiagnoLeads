/**
 * Where the name tags and the room names of the full-screen office go (#1177): no tag over
 * another tag, no room name under a panel, over an employee, over a tag or off the screen.
 */
import {
  type LabelBox,
  ROOM_GAP,
  ROOM_SHIFT_MAX,
  SCREEN_MARGIN,
  TAG_GAP,
  TAG_SHIFT_MAX,
  hudObstacles,
  layoutFloorLabels,
  placeTags,
} from '@/components/features/ai-employees/office-label-layout';
import { describe, expect, it } from 'vitest';

const size = { w: 1440, h: 900 };
const hit = (a: LabelBox, b: LabelBox) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const tag = (id: string, x: number, y: number, pinned = false) => ({
  id,
  at: { x, y },
  w: 180,
  h: 44,
  pinned,
});
const room = (id: string, ...anchors: [number, number][]) => ({
  id,
  anchors: anchors.map(([x, y]) => ({ x, y })),
  w: 100,
  h: 30,
});

describe('placeTags', () => {
  it('hangs a tag under its employee when nothing is in the way', () => {
    const placed = placeTags([tag('a', 400, 300), tag('b', 800, 300)]);
    expect(placed.a).toEqual({ x: 310, y: 300, w: 180, h: 44 });
    expect(placed.b).toEqual({ x: 710, y: 300, w: 180, h: 44 });
  });

  it('moves a tag straight up or down, never sideways, when two would cover each other', () => {
    const placed = placeTags([tag('a', 400, 300), tag('b', 460, 320), tag('c', 430, 310)]);
    const boxes = Object.values(placed);
    for (const [i, a] of boxes.entries()) {
      for (const b of boxes.slice(i + 1)) expect(hit(a, b)).toBe(false);
    }
    expect(placed.b.x).toBe(370);
    expect(placed.c.x).toBe(340);
    // The air between two tags
    expect(placed.c.y).toBe(placed.a.y + 44 + TAG_GAP);
  });

  it('keeps the chosen tag where it belongs: the others step aside', () => {
    const placed = placeTags([tag('back', 400, 290), tag('chosen', 420, 300, true)]);
    expect(placed.chosen.y).toBe(300);
    expect(placed.back.y).toBe(300 - 44 - TAG_GAP);
  });

  it('steps out from under a panel with a short step, and stays with its employee otherwise', () => {
    const panel = { x: 0, y: 320, w: 600, h: 400 };
    const near = placeTags([tag('a', 400, 300)], [panel]);
    expect(near.a.y).toBe(320 - 44 - TAG_GAP);
    const deep = placeTags([tag('a', 400, 320 + TAG_SHIFT_MAX + 60)], [panel]);
    expect(deep.a.y).toBe(320 + TAG_SHIFT_MAX + 60);
  });
});

describe('layoutFloorLabels', () => {
  it('leaves the name of a room at its first anchor when that place is free', () => {
    const laid = layoutFloorLabels({
      size,
      obstacles: [],
      tags: [],
      rooms: [room('lounge', [700, 450], [600, 600])],
    });
    expect(laid.rooms.lounge).toEqual({ x: 650, y: 435, hidden: false });
  });

  it('moves the name of a room out from under a panel, by the shortest way', () => {
    // The floor guide at the top of the screen, like over the sales floor
    const guide = { x: 450, y: 20, w: 540, h: 44 };
    const laid = layoutFloorLabels({
      size,
      obstacles: [guide],
      tags: [],
      rooms: [room('sales', [600, 60])],
    });
    expect(laid.rooms.sales).toEqual({ x: 550, y: 64 + ROOM_GAP, hidden: false });
  });

  it('brings a name that would be cut by the edge back into the screen', () => {
    const laid = layoutFloorLabels({
      size,
      obstacles: [],
      tags: [],
      rooms: [room('backoffice', [1420, 895])],
    });
    expect(laid.rooms.backoffice).toEqual({
      x: size.w - SCREEN_MARGIN - 100,
      y: size.h - SCREEN_MARGIN - 30,
      hidden: false,
    });
  });

  it('takes the next anchor when the first one is deep under a panel', () => {
    const staff = { x: 24, y: 500, w: 288, h: 380 };
    const laid = layoutFloorLabels({
      size,
      obstacles: [staff],
      tags: [],
      rooms: [room('training', [160, 700], [500, 640])],
    });
    expect(laid.rooms.training).toEqual({ x: 450, y: 625, hidden: false });
  });

  it('leaves a name out rather than far from its room or unreadable', () => {
    const panel = { x: 0, y: 0, w: 1440, h: 900 - 2 * ROOM_SHIFT_MAX };
    const laid = layoutFloorLabels({
      size,
      obstacles: [panel],
      tags: [],
      rooms: [room('sales', [700, 100])],
    });
    expect(laid.rooms.sales.hidden).toBe(true);
  });

  it('keeps the names of the rooms off the employees, their tags and each other', () => {
    const figure = { x: 370, y: 180, w: 60, h: 120 };
    const laid = layoutFloorLabels({
      size,
      obstacles: [],
      figures: [figure],
      tags: [tag('marketer', 400, 310)],
      rooms: [room('training', [400, 200]), room('lounge', [400, 330]), room('charging', [410, 335])],
    });
    const tagBox = { ...laid.tags.marketer, w: 180, h: 44 };
    const names = Object.values(laid.rooms).map((at) => ({ ...at, w: 100, h: 30 }));
    for (const [i, name] of names.entries()) {
      expect(name.hidden).toBe(false);
      expect(hit(name, figure)).toBe(false);
      expect(hit(name, tagBox)).toBe(false);
      for (const other of names.slice(i + 1)) expect(hit(name, other)).toBe(false);
    }
  });
});

describe('hudObstacles', () => {
  const full = { x: 0, y: 0, w: 1440, h: 900 };
  it('takes the panels, and what a bar across the screen holds, but not the floor or a veil', () => {
    const panel = { x: 24, y: 20, w: 288, h: 106 };
    const bar = { x: 0, y: 792, w: 1440, h: 84 };
    const buttons = { x: 346, y: 792, w: 748, h: 84 };
    expect(
      hudObstacles(
        [
          { box: full, parts: [panel] },
          { box: panel, parts: [] },
          { box: bar, parts: [buttons] },
          // Nothing drawn (a title for screen readers only, something not on this screen width)
          { box: { x: 24, y: 144, w: 0, h: 0 }, parts: [] },
        ],
        size
      )
    ).toEqual([panel, buttons]);
  });
});
