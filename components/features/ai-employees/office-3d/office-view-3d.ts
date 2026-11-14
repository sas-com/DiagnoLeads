/**
 * Where the camera of the 3D office looks, and where a place on the floor lands on the screen
 * (#1147). The camera is orthographic and keeps the angle of the 2D office, so both can be worked
 * out without a renderer: the 3D canvas places its camera from these functions, and the name tags
 * (DOM buttons over the canvas) are placed with the same ones, so a tag always sits on its robot.
 *
 * Pure functions.
 */
import { FLOOR_DEPTH, FLOOR_WIDTH, type FloorPoint } from '../office-map-layout';
import { HOME_CLOSE_UP } from '../office-president';

/**
 * The floor units the screen holds when the whole floor is in view, walls and a margin for the
 * panels included. Chosen so that the 3D floor starts as large as the 2D one (the same rooms at
 * the same places on the screen, within a few pixels at 1440 by 900).
 */
export const FLOOR_SPAN = { w: 34, h: 21.5 };

/** From this zoom on, the camera follows the chosen employee instead of resting on the middle */
export const FOLLOW_FROM = 1.05;

/** The camera sits this far from what it looks at, along each axis (the angle of the 2D office) */
export const CAMERA_OFFSET = 30;

/** The middle of the floor: where the camera rests while it follows nobody */
export const FLOOR_MIDDLE: FloorPoint = { x: FLOOR_WIDTH / 2, y: FLOOR_DEPTH / 2 };

export interface ScreenSize {
  w: number;
  h: number;
}

export interface ScreenPoint {
  x: number;
  y: number;
}

/** What the camera shows: enough to place the camera and to find any floor place on the screen */
export interface View3D {
  /** The place on the floor at the middle of the screen (before the pan) */
  target: FloorPoint;
  /** Screen pixels for one floor unit */
  pxPerUnit: number;
  /** How far the picture is dragged, in screen pixels */
  pan: ScreenPoint;
  size: ScreenSize;
}

/**
 * Screen pixels for one floor unit. A zoom of 1 is the same close-up the 2D office starts with;
 * a zoom of 1 / HOME_CLOSE_UP ("see the whole floor") fits the whole floor into the screen.
 */
export function pxPerUnit(size: ScreenSize, zoom: number): number {
  return Math.min(size.w / FLOOR_SPAN.w, size.h / FLOOR_SPAN.h) * HOME_CLOSE_UP * zoom;
}

/** Where the camera looks: at the followed employee once zoomed in, else at the middle */
export function viewTarget(zoom: number, followed: FloorPoint | null): FloorPoint {
  return zoom > FOLLOW_FROM && followed ? followed : FLOOR_MIDDLE;
}

// The camera's own axes, for a camera that looks from (1, 1, 1) at the origin with y up.
// Floor x runs to the lower right of the screen and floor y to the lower left, like the 2D office.
const SQRT2 = Math.SQRT2;
const SQRT6 = Math.sqrt(6);

/** Where a place on the floor (and a height over it, in floor units) lands on the screen */
export function projectFloor(point: FloorPoint, height: number, view: View3D): ScreenPoint {
  const dx = point.x - view.target.x;
  const dz = point.y - view.target.y;
  const right = (dx - dz) / SQRT2;
  const up = (2 * height - dx - dz) / SQRT6;
  return {
    x: view.size.w / 2 + right * view.pxPerUnit + view.pan.x,
    y: view.size.h / 2 - up * view.pxPerUnit + view.pan.y,
  };
}

/**
 * Where the camera stands for a view, in the coordinates of the 3D scene (the middle of the floor
 * at the origin, floor y along z). Dragging the picture to the right moves the camera to the left.
 */
export function cameraPosition(view: View3D): [x: number, y: number, z: number] {
  const right = -view.pan.x / view.pxPerUnit;
  const up = view.pan.y / view.pxPerUnit;
  return [
    view.target.x - FLOOR_MIDDLE.x + CAMERA_OFFSET + right / SQRT2 - up / SQRT6,
    CAMERA_OFFSET + (2 * up) / SQRT6,
    view.target.y - FLOOR_MIDDLE.y + CAMERA_OFFSET - right / SQRT2 - up / SQRT6,
  ];
}

/** One step of the camera gliding from where it looks to where it should look */
export function easeTarget(from: FloorPoint, to: FloorPoint, share: number): FloorPoint {
  const step = Math.max(0, Math.min(1, share));
  return { x: from.x + (to.x - from.x) * step, y: from.y + (to.y - from.y) * step };
}
