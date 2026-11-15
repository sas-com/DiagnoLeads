/**
 * The camera of the 3D office and where floor places land on the screen (#1147): pure functions,
 * no renderer. The name tags over the canvas are placed with them.
 */
import {
  CAMERA_OFFSET,
  FLOOR_MIDDLE,
  FLOOR_SPAN,
  FOLLOW_FROM,
  OPENING_CLOSEST,
  OPENING_SUBJECT,
  STAGE_FRAMES,
  SUBJECT_HEIGHT,
  type View3D,
  cameraPosition,
  easeTarget,
  easeView,
  openingView,
  stageView,
  projectFloor,
  pxPerUnit,
  viewTarget,
} from '@/components/features/ai-employees/office-3d/office-view-3d';
import { FLOOR_DEPTH, FLOOR_WIDTH } from '@/components/features/ai-employees/office-map-layout';
import { HOME_CLOSE_UP, homeCloseUp } from '@/components/features/ai-employees/office-president';
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
    const closeUp = homeCloseUp(size);
    const whole = pxPerUnit(size, 1 / closeUp);
    // The span of floor units the screen holds fits into the screen, both ways
    expect(whole * FLOOR_SPAN.w).toBeLessThanOrEqual(size.w + 0.001);
    expect(whole * FLOOR_SPAN.h).toBeLessThanOrEqual(size.h + 0.001);
    expect(pxPerUnit(size, 1)).toBeCloseTo(whole * closeUp);
    // A scene other than the floor names its close-up: the same on any screen
    expect(pxPerUnit(size, 2, HOME_CLOSE_UP)).toBeCloseTo(whole * HOME_CLOSE_UP * 2);
  });

  it('grows with the zoom and with the screen', () => {
    expect(pxPerUnit(size, 2)).toBeCloseTo(pxPerUnit(size, 1) * 2);
    expect(pxPerUnit({ w: 2880, h: 1800 }, 1, 1)).toBeCloseTo(pxPerUnit(size, 1, 1) * 2);
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
    // At the closest starting zoom the left and right corners sit within a few pixels of the edges
    const closest = view({ pxPerUnit: pxPerUnit(size, 1, HOME_CLOSE_UP) });
    const left = projectFloor({ x: 0, y: FLOOR_DEPTH }, 0, closest);
    const right = projectFloor({ x: FLOOR_WIDTH, y: 0 }, 0, closest);
    expect(Math.abs(left.x)).toBeLessThan(24);
    expect(Math.abs(right.x - size.w)).toBeLessThan(24);
  });

  it('keeps every corner of the floor on the screen when the whole floor is in view', () => {
    const whole = view({ pxPerUnit: pxPerUnit(size, 1, 1) });
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

describe('stageView (#1148)', () => {
  const sizes = [
    { w: 1280, h: 720 },
    { w: 1440, h: 900 },
    { w: 1920, h: 1080 },
  ];
  const subject = { x: 2.1, y: 12.05 };

  it('is the zoom and the drag of the president on the floor', () => {
    const size = { w: 1440, h: 900 };
    const pan = { x: 30, y: -12 };
    const followed = { x: 5, y: 3 };
    const view = stageView('world', { size, zoom: 1.4, pan, followed, subject });
    expect(view).toEqual({ target: followed, pxPerUnit: pxPerUnit(size, 1.4), pan, size });
    // Zoomed out it rests on the middle, whoever is chosen
    expect(stageView('world', { size, zoom: 1, pan, followed, subject }).target).toEqual(
      FLOOR_MIDDLE
    );
  });

  it('puts the subject of a scene at the scene’s place on every screen, closer than the floor', () => {
    for (const stage of ['talk', 'room', 'studio'] as const) {
      for (const size of sizes) {
        // What the president did on the floor (a zoom, a drag) does not move a scene
        const view = stageView(stage, {
          size,
          zoom: 0.8,
          pan: { x: 200, y: 90 },
          followed: { x: 20, y: 3 },
          subject,
        });
        const at = projectFloor(subject, SUBJECT_HEIGHT, view);
        expect(at.x).toBeCloseTo(STAGE_FRAMES[stage].at.x * size.w, 6);
        expect(at.y).toBeCloseTo(STAGE_FRAMES[stage].at.y * size.h, 6);
        expect(view.pxPerUnit).toBeGreaterThan(pxPerUnit(size, 1));
        // The whole robot (2.4 high) fits over and under that place
        const feet = projectFloor(subject, 0, view);
        const head = projectFloor(subject, 2.4, view);
        expect(head.y).toBeGreaterThan(0);
        expect(feet.y).toBeLessThan(size.h);
      }
    }
  });

  it('keeps the employee left of the panels: in the left half of the screen', () => {
    for (const stage of ['talk', 'room', 'studio'] as const) {
      expect(STAGE_FRAMES[stage].at.x).toBeLessThan(0.5);
    }
  });

  it('shows the floor when a scene has nothing to be about', () => {
    const size = { w: 1440, h: 900 };
    const pan = { x: 0, y: 0 };
    expect(stageView('talk', { size, zoom: 1, pan, followed: null, subject: null })).toEqual(
      stageView('world', { size, zoom: 1, pan, followed: null, subject: null })
    );
  });
});

describe('openingView (#1148)', () => {
  const subject = { x: 2.1, y: 12.05 };
  // The opening of the customization, as it is laid out on three screens: left, over the panel
  const screens = [
    { size: { w: 1280, h: 720 }, opening: { x: 24, y: 80, w: 416, h: 300 } },
    { size: { w: 1440, h: 900 }, opening: { x: 24, y: 80, w: 416, h: 470 } },
    { size: { w: 1920, h: 1080 }, opening: { x: 24, y: 80, w: 416, h: 650 } },
    // A narrow screen: the opening is as wide as the screen and low
    { size: { w: 800, h: 900 }, opening: { x: 16, y: 80, w: 768, h: 224 } },
  ];

  it('shows the whole robot inside the opening, its middle at the middle of it', () => {
    for (const { size, opening } of screens) {
      const view = openingView(subject, opening, size);
      if (!view) throw new Error('no view');
      const middle = projectFloor(subject, OPENING_SUBJECT.height / 2, view);
      expect(middle.x).toBeCloseTo(opening.x + opening.w / 2, 6);
      expect(middle.y).toBeCloseTo(opening.y + opening.h / 2, 6);
      // From the floor under it to what floats over its head
      const feet = projectFloor(subject, 0, view);
      const top = projectFloor(subject, OPENING_SUBJECT.height, view);
      expect(top.y).toBeGreaterThan(opening.y);
      expect(feet.y).toBeLessThan(opening.y + opening.h);
      // And its arms: half the width to each side of the middle
      const reach = (OPENING_SUBJECT.width / 2) * view.pxPerUnit;
      expect(middle.x - reach).toBeGreaterThan(opening.x);
      expect(middle.x + reach).toBeLessThan(opening.x + opening.w);
      expect(view.pxPerUnit).toBeLessThanOrEqual(OPENING_CLOSEST);
      expect(view.target).toEqual(subject);
    }
  });

  it('shows it as large as the opening allows: a taller opening, a larger robot', () => {
    const size = { w: 1440, h: 900 };
    const low = openingView(subject, { x: 24, y: 80, w: 416, h: 240 }, size);
    const tall = openingView(subject, { x: 24, y: 80, w: 416, h: 420 }, size);
    expect(tall?.pxPerUnit).toBeGreaterThan(low?.pxPerUnit ?? Number.POSITIVE_INFINITY);
  });

  it('has no view for an opening that is not laid out yet', () => {
    const size = { w: 1440, h: 900 };
    expect(openingView(subject, { x: 0, y: 0, w: 0, h: 0 }, size)).toBeNull();
    expect(openingView(subject, { x: 24, y: 80, w: 416, h: 0 }, size)).toBeNull();
  });

  it('is what the customization shows once it has an opening, and only that scene’s frame before', () => {
    const size = { w: 1440, h: 900 };
    const opening = { x: 24, y: 80, w: 416, h: 470 };
    const base = { size, zoom: 1, pan: { x: 0, y: 0 }, followed: null, subject };
    expect(stageView('studio', { ...base, opening })).toEqual(openingView(subject, opening, size));
    // Not laid out yet, or no opening at all (the 2D preview): the scene's own place
    const framed = stageView('studio', base);
    expect(stageView('studio', { ...base, opening: null })).toEqual(framed);
    expect(stageView('studio', { ...base, opening: { x: 0, y: 0, w: 0, h: 0 } })).toEqual(framed);
    // The floor never looks through an opening
    expect(stageView('world', { ...base, opening })).toEqual(stageView('world', base));
  });

  it('keeps the employee in the opening while it is still on its way to its place', () => {
    const size = { w: 1440, h: 900 };
    const opening = { x: 24, y: 80, w: 416, h: 470 };
    // Called back from its rest: the status already puts it at its desk, it is in the corridor
    const onTheWay = { x: 9.5, y: 7.2 };
    const view = stageView('studio', {
      size,
      zoom: 1,
      pan: { x: 0, y: 0 },
      followed: onTheWay,
      subject,
      opening,
    });
    expect(view).toEqual(openingView(onTheWay, opening, size));
    // Without an opening (the 2D picture) the scene is about where the status puts it, as before
    expect(
      stageView('studio', { size, zoom: 1, pan: { x: 0, y: 0 }, followed: onTheWay, subject })
        .target
    ).toEqual(subject);
  });
});

describe('easeView', () => {
  const size = { w: 1440, h: 900 };
  const from: View3D = { target: { x: 12, y: 8 }, pxPerUnit: 50, pan: { x: 0, y: 0 }, size };
  const to: View3D = { target: { x: 2, y: 12 }, pxPerUnit: 100, pan: { x: -260, y: 20 }, size };

  it('glides everything part of the way, arrives with a full step, and never overshoots', () => {
    const half = easeView(from, to, 0.5);
    expect(half).toEqual({ target: { x: 7, y: 10 }, pxPerUnit: 75, pan: { x: -130, y: 10 }, size });
    expect(easeView(from, to, 1)).toEqual(to);
    expect(easeView(from, to, 7)).toEqual(to);
    expect(easeView(from, to, -1)).toEqual(from);
  });
});
