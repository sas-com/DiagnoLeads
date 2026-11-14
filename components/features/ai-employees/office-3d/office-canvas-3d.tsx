'use client';

import type { DeskStatus } from '@/lib/features/ai-employees/office';
import type { AiTone, RobotLook } from '@/lib/features/ai-employees/types/profile';
import type { AiEmployeeRole } from '@/lib/features/ai-employees/types/roles';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef, useState } from 'react';
import type { Group, OrthographicCamera } from 'three';
import { FLOOR_DEPTH, FLOOR_WIDTH, type FloorPoint, spotOf } from '../office-map-layout';
import { type OfficeEvent, emotionOf } from './office-emotion';
import { pointAlong, routeBetween, routeLength } from './office-nav';
import {
  OfficeDaylight,
  OfficeReflections,
  OfficeScenery,
  OfficeShadowPace,
} from './office-scenery-3d-view';
import {
  CAMERA_OFFSET,
  FLOOR_MIDDLE,
  type ScreenPoint,
  type View3D,
  cameraPosition,
  easeTarget,
  pxPerUnit,
  viewTarget,
} from './office-view-3d';
import { Robot3D } from './robot-3d';

const NO_PAN: ScreenPoint = { x: 0, y: 0 };

/** How fast a robot walks, in floor units a second */
export const WALK_SPEED = 3.2;

export interface Office3DEmployee {
  role: AiEmployeeRole;
  name: string;
  status: Exclude<DeskStatus, 'vacant'>;
  look: RobotLook;
  tone: AiTone;
}

/** Where every employee stands right now, by role: read each frame by the name tags */
export type Places3D = Partial<Record<AiEmployeeRole, FloorPoint>>;

/**
 * A seat nobody was hired for yet: a faint figure on the seat, so the floor shows who is missing
 * like the 2D office does. Its name tag (a DOM button) hires.
 */
function VacantSeat({ role, night }: { role: AiEmployeeRole; night: boolean }) {
  const spot = spotOf(role, 'vacant');
  const color = night ? '#aab4c8' : '#8a93a6';
  return (
    <group position={[spot.x, 0, spot.y]}>
      <mesh position={[0, 0.95, 0]}>
        <capsuleGeometry args={[0.38, 0.75, 6, 16]} />
        <meshStandardMaterial color={color} transparent opacity={0.22} depthWrite={false} />
      </mesh>
      <mesh position={[0, 1.95, 0]}>
        <sphereGeometry args={[0.42, 20, 16]} />
        <meshStandardMaterial color={color} transparent opacity={0.22} depthWrite={false} />
      </mesh>
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.62, 0.72, 40]} />
        <meshBasicMaterial color={color} transparent opacity={0.6} />
      </mesh>
    </group>
  );
}

/**
 * An employee on the floor: it stands where its status puts it, and when the status changes it
 * walks there (out of the door, along the corridor, in through the other door) instead of
 * jumping. People who ask for less motion get the jump.
 */
function Walker({
  employee,
  event,
  still,
  onMove,
  onWalking,
}: {
  employee: Office3DEmployee;
  event: OfficeEvent | null;
  still: boolean;
  /** Told where the employee is, each time it moves */
  onMove: (role: AiEmployeeRole, at: FloorPoint) => void;
  /** Told when the employee sets off and when it arrives */
  onWalking?: (role: AiEmployeeRole, walking: boolean) => void;
}) {
  const invalidate = useThree((state) => state.invalidate);
  const group = useRef<Group>(null);
  const spot = spotOf(employee.role, employee.status);
  const restHeading = spot.facing === 'left' ? 0 : Math.PI / 2;
  const walk = useRef<{ route: FloorPoint[]; length: number; travelled: number }>({
    route: [spot],
    length: 0,
    travelled: 0,
  });
  const here = useRef<FloorPoint>({ x: spot.x, y: spot.y });
  const [walking, setWalking] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new target is a new place, not a new object
  useEffect(() => {
    const route = still ? [spot] : routeBetween(here.current, spot);
    const length = routeLength(route);
    walk.current = { route, length, travelled: 0 };
    setWalking(length > 0.05);
    if (length <= 0.05 && group.current) {
      here.current = { x: spot.x, y: spot.y };
      onMove(employee.role, here.current);
      group.current.position.set(spot.x, 0, spot.y);
      group.current.rotation.y = restHeading;
      // With less motion the canvas only draws when something changed: this did
      invalidate();
    }
  }, [spot.x, spot.y, still]);

  // The office says in words that the employee is on its way (the canvas is decoration)
  const role = employee.role;
  useEffect(() => {
    onWalking?.(role, walking);
  }, [onWalking, role, walking]);

  useFrame((_, delta) => {
    const state = walk.current;
    if (!group.current || state.travelled >= state.length) return;
    state.travelled = Math.min(state.length, state.travelled + delta * WALK_SPEED);
    const at = pointAlong(state.route, state.travelled);
    here.current = { x: at.x, y: at.y };
    onMove(employee.role, here.current);
    group.current.position.set(at.x, 0, at.y);
    const arrived = state.travelled >= state.length;
    group.current.rotation.y = arrived ? restHeading : at.heading;
    if (arrived) setWalking(false);
  });

  return (
    <group ref={group} position={[spot.x, 0, spot.y]} rotation={[0, restHeading, 0]}>
      <Robot3D
        role={employee.role}
        status={employee.status}
        look={employee.look}
        tone={employee.tone}
        emotion={emotionOf(employee.status, walking ? null : event)}
        walking={walking}
        still={still}
      />
    </group>
  );
}

/**
 * The camera looks down at the same angle as the 2D office. Zoomed out it rests on the middle of
 * the floor; zoomed in it follows the chosen employee, also while it walks; and it can be dragged.
 * Each frame it tells where it looks (`onView`), so that the name tags over the canvas follow it.
 */
function CameraRig({
  zoom,
  pan,
  still,
  follow,
  places,
  onView,
}: {
  zoom: number;
  pan: ScreenPoint;
  /** Less motion: the camera jumps instead of gliding */
  still: boolean;
  /** Where the followed employee is, or null to rest on the middle of the floor */
  follow: () => FloorPoint | null;
  places: React.RefObject<Places3D>;
  onView?: (view: View3D, places: Places3D) => void;
}) {
  const camera = useThree((state) => state.camera) as OrthographicCamera;
  const size = useThree((state) => state.size);
  const invalidate = useThree((state) => state.invalidate);
  const looking = useRef<FloorPoint>(FLOOR_MIDDLE);

  // The angle is set once; from then on the camera only slides
  useEffect(() => {
    camera.position.set(CAMERA_OFFSET, CAMERA_OFFSET, CAMERA_OFFSET);
    camera.lookAt(0, 0, 0);
  }, [camera]);

  // With less motion the canvas only draws when something changed: a new zoom, pan or size did
  // biome-ignore lint/correctness/useExhaustiveDependencies: the values are the reason to draw again
  useEffect(() => {
    invalidate();
  }, [invalidate, zoom, pan.x, pan.y, size.width, size.height, still]);

  useFrame((_, delta) => {
    const to = viewTarget(zoom, follow());
    looking.current = still ? to : easeTarget(looking.current, to, delta * 4);
    const view: View3D = {
      target: looking.current,
      pxPerUnit: pxPerUnit({ w: size.width, h: size.height }, zoom),
      pan,
      size: { w: size.width, h: size.height },
    };
    const [x, y, z] = cameraPosition(view);
    camera.position.set(x, y, z);
    if (camera.zoom !== view.pxPerUnit) {
      camera.zoom = view.pxPerUnit;
      camera.updateProjectionMatrix();
    }
    onView?.(view, places.current ?? {});
  });
  return null;
}

/** Reports the frames drawn each second (for measuring the spike) */
function FrameCounter({
  onFps,
  onReady,
}: {
  onFps?: (fps: number) => void;
  onReady?: () => void;
}) {
  const count = useRef({ frames: 0, since: 0 });
  const drawn = useRef(false);
  useFrame(({ clock }) => {
    // The first frame: the floor is there, and the 2D one behind it may go
    if (!drawn.current) {
      drawn.current = true;
      onReady?.();
    }
    count.current.frames += 1;
    const elapsed = clock.elapsedTime - count.current.since;
    if (elapsed >= 1) {
      onFps?.(Math.round(count.current.frames / elapsed));
      count.current = { frames: 0, since: clock.elapsedTime };
    }
  });
  return null;
}

/**
 * The office floor in 3D (#1135, #1147): the same layout, employees and looks as the 2D office,
 * with robots that walk between the rooms and show how they feel. Decoration only: it is hidden
 * from assistive technology and takes no pointer, so the floor under it is still dragged, and
 * everything it shows is also said by the panels and the name tags (DOM) around it.
 */
export default function OfficeCanvas3D({
  employees,
  vacant = [],
  events,
  night,
  zoom = 1,
  pan = NO_PAN,
  focus = null,
  reducedMotion = false,
  onFps,
  onReady,
  onView,
  onWalking,
}: {
  employees: readonly Office3DEmployee[];
  /** The roles nobody was hired for: their seats show a faint figure */
  vacant?: readonly AiEmployeeRole[];
  /** What just happened to an employee, by role */
  events: Partial<Record<AiEmployeeRole, OfficeEvent>>;
  night: boolean;
  zoom?: number;
  /** How far the floor was dragged, in screen pixels */
  pan?: ScreenPoint;
  /** The employee the camera follows when it is zoomed in */
  focus?: AiEmployeeRole | null;
  reducedMotion?: boolean;
  onFps?: (fps: number) => void;
  /** Told once, when the first frame was drawn */
  onReady?: () => void;
  /** Told each frame where the camera looks and where the employees are */
  onView?: (view: View3D, places: Places3D) => void;
  onWalking?: (role: AiEmployeeRole, walking: boolean) => void;
}) {
  const places = useRef<Places3D>({});
  // When somebody last moved over the floor: the shadows are drawn again while they do
  const movedAt = useRef(0);
  const onMove = (role: AiEmployeeRole, at: FloorPoint) => {
    places.current[role] = at;
    movedAt.current = performance.now();
  };
  return (
    <Canvas
      orthographic
      shadows
      dpr={[1, 2]}
      // Nothing moves by itself for people who ask for less motion: draw only on a change
      frameloop={reducedMotion ? 'demand' : 'always'}
      camera={{ position: [CAMERA_OFFSET, CAMERA_OFFSET, CAMERA_OFFSET], near: 0.1, far: 200 }}
      aria-hidden="true"
      className="absolute inset-0"
      // The canvas is a picture: the pointer goes through it to the floor under it (dragging) and
      // to the name tags over it. The library sets `pointer-events: auto` inline, so a class
      // cannot switch it off
      style={{ pointerEvents: 'none' }}
    >
      <CameraRig
        zoom={zoom}
        pan={pan}
        still={reducedMotion}
        follow={() => (focus ? (places.current[focus] ?? null) : null)}
        places={places}
        onView={onView}
      />
      <FrameCounter onFps={onFps} onReady={onReady} />
      <OfficeReflections night={night} />
      <OfficeShadowPace walking={() => performance.now() - movedAt.current < 200} />
      <OfficeDaylight night={night} />
      {/* The middle of the floor sits at the origin, where the camera looks */}
      <group position={[-FLOOR_WIDTH / 2, 0, -FLOOR_DEPTH / 2]}>
        <OfficeScenery night={night} />
        {vacant.map((role) => (
          <VacantSeat key={role} role={role} night={night} />
        ))}
        {employees.map((employee) => (
          <Walker
            key={employee.role}
            employee={employee}
            event={events[employee.role] ?? null}
            still={reducedMotion}
            onMove={onMove}
            onWalking={onWalking}
          />
        ))}
      </group>
    </Canvas>
  );
}
