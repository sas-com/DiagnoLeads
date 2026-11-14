/**
 * The camera of the 3D office and where floor places land on the screen (#1147): pure functions,
 * no renderer. The name tags over the canvas are placed with them.
 */
import {
  CAMERA_OFFSET,
  FLOOR_MIDDLE,
  FLOOR_SPAN,
  FOLLOW_FROM,
  type View3D,
  cameraPosition,
  easeTarget,
  projectFloor,
  pxPerUnit,
  viewTarget,
} from '@/components/features/ai-employees/office-3d/office-view-3d';
import { FLOOR_DEPTH, FLOOR_WIDTH } from '@/components/features/ai-employees/office-map-layout';
import { HOME_CLOSE_UP } from '@/components/features/ai-employees/office-president';
import { describe, expect, it } from 'vitest';

const size = { w: 1440, h: 900 };
const view = (over: Partial<View3D> = {}): View3D => ({
  target: FLOOR_MIDDLE,
  pxPerUnit: pxPerUnit(size, 1),
  pan: { x: 0, y: 0 },
  size,
  ...over,
});

describe('pxPerUnit', () => {
  it('starts as close as the 2D office, and fits the whole floor when stepped back', () => {
    const whole = pxPerUnit(size, 1 / HOME_CLOSE_UP);
    // The span of floor units the screen holds fits into the screen, both ways
    expect(whole * FLOOR_SPAN.w).toBeLessThanOrEqual(size.w + 0.001);
    expect(whole * FLOOR_SPAN.h).toBeLessThanOrEqual(size.h + 0.001);
    expect(pxPerUnit(size, 1)).toBeCloseTo(whole * HOME_CLOSE_UP);
  });

  it('grows with the zoom and with the screen', () => {
    expect(pxPerUnit(size, 2)).toBeCloseTo(pxPerUnit(size, 1) * 2);
    expect(pxPerUnit({ w: 2880, h: 1800 }, 1)).toBeCloseTo(pxPerUnit(size, 1) * 2);
  });
});

describe('viewTarget', () => {
  const employee = { x: 3, y: 12 };

  it('rests on the middle of the floor until the camera is zoomed in', () => {
    expect(viewTarget(1, employee)).toEqual(FLOOR_MIDDLE);
    expect(viewTarget(FOLLOW_FROM, employee)).toEqual(FLOOR_MIDDLE);
  });

  it('follows the chosen employee once zoomed in, and nobody when none is chosen', () => {
    expect(viewTarget(1.25, employee)).toEqual(employee);
    expect(viewTarget(1.25, null)).toEqual(FLOOR_MIDDLE);
  });
});

describe('projectFloor', () => {
  it('puts what the camera looks at in the middle of the screen', () => {
    expect(projectFloor(FLOOR_MIDDLE, 0, view())).toEqual({ x: 720, y: 450 });
    const target = { x: 3, y: 12 };
    expect(projectFloor(target, 0, view({ target }))).toEqual({ x: 720, y: 450 });
  });

  it('runs floor x to the lower right and floor y to the lower left, like the 2D office', () => {
    const middle = projectFloor(FLOOR_MIDDLE, 0, view());
    const alongX = projectFloor({ x: FLOOR_MIDDLE.x + 1, y: FLOOR_MIDDLE.y }, 0, view());
    const alongY = projectFloor({ x: FLOOR_MIDDLE.x, y: FLOOR_MIDDLE.y + 1 }, 0, view());
    expect(alongX.x).toBeGreaterThan(middle.x);
    expect(alongX.y).toBeGreaterThan(middle.y);
    expect(alongY.x).toBeLessThan(middle.x);
    expect(alongY.y).toBeGreaterThan(middle.y);
    // The two axes are mirror images of each other
    expect(alongX.x - middle.x).toBeCloseTo(middle.x - alongY.x);
    expect(alongX.y - middle.y).toBeCloseTo(alongY.y - middle.y);
  });

  it('puts something higher over the same place straight above it', () => {
    const feet = projectFloor({ x: 5, y: 5 }, 0, view());
    const head = projectFloor({ x: 5, y: 5 }, 2, view());
    expect(head.x).toBeCloseTo(feet.x);
    expect(head.y).toBeLessThan(feet.y);
  });

  it('moves with the pan by exactly the dragged pixels, and scales around the target', () => {
    const still = projectFloor({ x: 2, y: 3 }, 0, view());
    const dragged = projectFloor({ x: 2, y: 3 }, 0, view({ pan: { x: 40, y: -25 } }));
    expect(dragged.x - still.x).toBeCloseTo(40);
    expect(dragged.y - still.y).toBeCloseTo(-25);
    const closer = projectFloor({ x: 2, y: 3 }, 0, view({ pxPerUnit: pxPerUnit(size, 2) }));
    expect(closer.x - 720).toBeCloseTo((still.x - 720) * 2);
    expect(closer.y - 450).toBeCloseTo((still.y - 450) * 2);
  });

  it('starts with the far corners of the floor at the edges of the screen, like the 2D office', () => {
    // At the starting zoom the left and right corners sit within a few pixels of the edges
    const left = projectFloor({ x: 0, y: FLOOR_DEPTH }, 0, view());
    const right = projectFloor({ x: FLOOR_WIDTH, y: 0 }, 0, view());
    expect(Math.abs(left.x)).toBeLessThan(24);
    expect(Math.abs(right.x - size.w)).toBeLessThan(24);
  });

  it('keeps every corner of the floor on the screen when the whole floor is in view', () => {
    const whole = view({ pxPerUnit: pxPerUnit(size, 1 / HOME_CLOSE_UP) });
    for (const corner of [
      { x: 0, y: 0 },
      { x: FLOOR_WIDTH, y: 0 },
      { x: 0, y: FLOOR_DEPTH },
      { x: FLOOR_WIDTH, y: FLOOR_DEPTH },
    ]) {
      const at = projectFloor(corner, 0, whole);
      expect(at.x).toBeGreaterThanOrEqual(0);
      expect(at.x).toBeLessThanOrEqual(size.w);
      expect(at.y).toBeGreaterThanOrEqual(0);
      expect(at.y).toBeLessThanOrEqual(size.h);
    }
  });
});

describe('cameraPosition', () => {
  it('stands the same distance from the middle of the floor along each axis', () => {
    expect(cameraPosition(view())).toEqual([CAMERA_OFFSET, CAMERA_OFFSET, CAMERA_OFFSET]);
  });

  it('moves with what it looks at, in the scene’s coordinates (the middle at the origin)', () => {
    const [x, y, z] = cameraPosition(view({ target: { x: 3, y: 12 } }));
    expect(x).toBeCloseTo(3 - FLOOR_MIDDLE.x + CAMERA_OFFSET);
    expect(y).toBeCloseTo(CAMERA_OFFSET);
    expect(z).toBeCloseTo(12 - FLOOR_MIDDLE.y + CAMERA_OFFSET);
  });

  it('agrees with projectFloor about the pan: the camera slides across its own plane', () => {
    // A camera moved along its right and up axes still looks along (-1, -1, -1): the sum of the
    // three coordinates measures the distance along that line, and it must not change
    const rest = cameraPosition(view());
    const dragged = cameraPosition(view({ pan: { x: 120, y: -80 } }));
    expect(dragged[0] + dragged[1] + dragged[2]).toBeCloseTo(rest[0] + rest[1] + rest[2]);
    // Dragging the picture to the right moves the camera to its own left (towards -x, +z)
    const right = cameraPosition(view({ pan: { x: 100, y: 0 } }));
    expect(right[0]).toBeLessThan(rest[0]);
    expect(right[2]).toBeGreaterThan(rest[2]);
    expect(right[1]).toBeCloseTo(rest[1]);
    // Dragging it down lifts the camera
    const down = cameraPosition(view({ pan: { x: 0, y: 100 } }));
    expect(down[1]).toBeGreaterThan(rest[1]);
  });
});

describe('easeTarget', () => {
  it('glides part of the way, arrives with a full step, and never overshoots', () => {
    const from = { x: 0, y: 0 };
    const to = { x: 10, y: 4 };
    expect(easeTarget(from, to, 0.5)).toEqual({ x: 5, y: 2 });
    expect(easeTarget(from, to, 1)).toEqual(to);
    expect(easeTarget(from, to, 3)).toEqual(to);
    expect(easeTarget(from, to, -1)).toEqual(from);
  });
});
