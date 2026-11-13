'use client';

import type { DeskStatus } from '@/lib/features/ai-employees/office';
import type { AiTone, RobotLook } from '@/lib/features/ai-employees/types/profile';
import type { AiEmployeeRole } from '@/lib/features/ai-employees/types/roles';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CanvasTexture, type Group, type OrthographicCamera, SRGBColorSpace } from 'three';
import {
  AREA_RECTS,
  CHARGING_PADS,
  FLOOR_DEPTH,
  FLOOR_WIDTH,
  type FloorPoint,
  OFFICE_AREAS,
  type OfficeArea,
  ROLE_DESKS,
  TRAINING_DESKS,
  spotOf,
} from '../office-map-layout';
import { type OfficeEvent, emotionOf } from './office-emotion';
import { pointAlong, routeBetween, routeLength } from './office-nav';
import { Robot3D } from './robot-3d';

/** How fast a robot walks, in floor units a second */
export const WALK_SPEED = 3.2;

export interface Office3DEmployee {
  role: AiEmployeeRole;
  name: string;
  status: Exclude<DeskStatus, 'vacant'>;
  look: RobotLook;
  tone: AiTone;
}

const AREA_COLORS: Readonly<Record<OfficeArea, [day: string, night: string]>> = {
  sales: ['#e8d3ae', '#5b4f3c'],
  marketing: ['#dfe6ee', '#3d4654'],
  engineering: ['#e8d3ae', '#5b4f3c'],
  corridor: ['#f1f3f6', '#454c59'],
  training: ['#e3e8ef', '#3f4856'],
  lounge: ['#c9a57a', '#4f4030'],
  charging: ['#d9dee6', '#3a424f'],
  backoffice: ['#f3ead9', '#544a3b'],
};

/** The floor, the back walls and the furniture, from the same layout as the 2D office */
function Floor({ night }: { night: boolean }) {
  const wall = night ? '#39414f' : '#e9e4da';
  const desk = night ? '#4a3a2c' : '#7a5a3f';
  return (
    <group>
      <mesh position={[FLOOR_WIDTH / 2, -0.2, FLOOR_DEPTH / 2]} receiveShadow>
        <boxGeometry args={[FLOOR_WIDTH + 0.6, 0.3, FLOOR_DEPTH + 0.6]} />
        <meshStandardMaterial color={night ? '#1d2330' : '#5d6373'} />
      </mesh>
      {OFFICE_AREAS.map((area) => {
        const r = AREA_RECTS[area];
        return (
          <mesh
            key={area}
            position={[r.x + r.w / 2, -0.02, r.y + r.h / 2]}
            rotation={[-Math.PI / 2, 0, 0]}
            receiveShadow
          >
            <planeGeometry args={[r.w - 0.06, r.h - 0.06]} />
            <meshStandardMaterial color={AREA_COLORS[area][night ? 1 : 0]} roughness={0.9} />
          </mesh>
        );
      })}
      {/* The two back walls */}
      <mesh position={[FLOOR_WIDTH / 2, 1.1, -0.1]}>
        <boxGeometry args={[FLOOR_WIDTH + 0.4, 2.3, 0.2]} />
        <meshStandardMaterial color={wall} />
      </mesh>
      <mesh position={[-0.1, 1.1, FLOOR_DEPTH / 2]}>
        <boxGeometry args={[0.2, 2.3, FLOOR_DEPTH + 0.4]} />
        <meshStandardMaterial color={wall} />
      </mesh>
      {/* Glass partitions between the rooms and the corridor, with a gap for each door */}
      {OFFICE_AREAS.filter((area) => area !== 'corridor').map((area) => {
        const r = AREA_RECTS[area];
        const z = r.y < AREA_RECTS.corridor.y ? r.y + r.h : r.y;
        const half = (r.w - 2.2) / 2;
        return [r.x + half / 2, r.x + r.w - half / 2].map((x) => (
          <mesh key={`${area}-${x}`} position={[x, 0.75, z]}>
            <boxGeometry args={[half - 0.1, 1.5, 0.06]} />
            <meshStandardMaterial color="#9fd3e6" transparent opacity={0.28} />
          </mesh>
        ));
      })}
      {/* The desks of the roles, the study desks and the charging pads */}
      {[...Object.values(ROLE_DESKS), ...TRAINING_DESKS].map((d) => (
        <mesh key={`${d.x}-${d.y}`} position={[d.x + d.w / 2, 0.38, d.y + d.d / 2]} castShadow>
          <boxGeometry args={[d.w, 0.76, d.d]} />
          <meshStandardMaterial color={desk} roughness={0.7} />
        </mesh>
      ))}
      {CHARGING_PADS.map((pad) => (
        <mesh key={`${pad.x}-${pad.y}`} position={[pad.x + pad.w / 2, 0.03, pad.y + pad.d / 2]}>
          <cylinderGeometry
            args={[Math.min(pad.w, pad.d) / 2, Math.min(pad.w, pad.d) / 2, 0.06, 32]}
          />
          <meshStandardMaterial color="#3a3320" emissive="#e9cf9a" emissiveIntensity={0.25} />
        </mesh>
      ))}
    </group>
  );
}

/** The name of an employee over its head, drawn once into a texture */
function NameTag({ name }: { name: string }) {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 96;
    const context = canvas.getContext('2d');
    if (context) {
      context.fillStyle = 'rgba(10,14,24,0.86)';
      context.fillRect(0, 0, 512, 96);
      context.fillStyle = '#f5f1e8';
      context.font = 'bold 44px sans-serif';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(name, 256, 50, 480);
    }
    const map = new CanvasTexture(canvas);
    map.colorSpace = SRGBColorSpace;
    return map;
  }, [name]);
  return (
    <sprite position={[0, 2.85, 0]} scale={[2.2, 0.41, 1]}>
      <spriteMaterial map={texture} depthTest={false} />
    </sprite>
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
}: {
  employee: Office3DEmployee;
  event: OfficeEvent | null;
  still: boolean;
  /** Told where the employee is, each time it moves */
  onMove: (role: AiEmployeeRole, at: FloorPoint) => void;
}) {
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
    }
  }, [spot.x, spot.y, still]);

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
      />
      <NameTag name={employee.name} />
    </group>
  );
}

/**
 * The camera looks down at the same angle as the 2D office. Zoomed out it keeps the whole floor
 * in view; zoomed in it follows the chosen employee, also while it walks.
 */
function CameraRig({
  zoom,
  world,
  follow,
}: {
  zoom: number;
  world: React.RefObject<Group | null>;
  /** Where the followed employee is, or null to rest on the middle of the floor */
  follow: () => FloorPoint | null;
}) {
  const camera = useThree((state) => state.camera) as OrthographicCamera;
  const size = useThree((state) => state.size);
  useEffect(() => {
    // The floor seen from this angle is about 29 units wide and 19 high, walls included
    camera.zoom = Math.min(size.width / 29, size.height / 19) * zoom;
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  }, [camera, size.width, size.height, zoom]);
  useFrame((_, delta) => {
    if (!world.current) return;
    // The world slides under the camera, so that what is followed comes to the middle
    const at = zoom > 1.05 ? follow() : null;
    const x = -(at?.x ?? FLOOR_WIDTH / 2);
    const z = -(at?.y ?? FLOOR_DEPTH / 2);
    const ease = Math.min(1, delta * 4);
    world.current.position.x += (x - world.current.position.x) * ease;
    world.current.position.z += (z - world.current.position.z) * ease;
  });
  return null;
}

/** Reports the frames drawn each second (for measuring the spike) */
function FrameCounter({ onFps }: { onFps?: (fps: number) => void }) {
  const count = useRef({ frames: 0, since: 0 });
  useFrame(({ clock }) => {
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
 * The office floor in 3D (#1135, spike): the same layout, employees and looks as the 2D office,
 * with robots that walk between the rooms and show how they feel. Decoration only: everything it
 * shows is also in the panels around it, so it is hidden from assistive technology.
 */
export default function OfficeCanvas3D({
  employees,
  events,
  night,
  zoom = 1,
  focus = null,
  reducedMotion = false,
  onFps,
}: {
  employees: readonly Office3DEmployee[];
  /** What just happened to an employee, by role */
  events: Partial<Record<AiEmployeeRole, OfficeEvent>>;
  night: boolean;
  zoom?: number;
  /** The employee the camera follows when it is zoomed in */
  focus?: AiEmployeeRole | null;
  reducedMotion?: boolean;
  onFps?: (fps: number) => void;
}) {
  const world = useRef<Group>(null);
  const places = useRef<Partial<Record<AiEmployeeRole, FloorPoint>>>({});
  const onMove = (role: AiEmployeeRole, at: FloorPoint) => {
    places.current[role] = at;
  };
  return (
    <Canvas
      orthographic
      shadows
      dpr={[1, 2]}
      camera={{ position: [30, 30, 30], near: 0.1, far: 200 }}
      aria-hidden="true"
      className="absolute inset-0"
    >
      <CameraRig
        zoom={zoom}
        world={world}
        follow={() => (focus ? (places.current[focus] ?? null) : null)}
      />
      <FrameCounter onFps={onFps} />
      <ambientLight intensity={night ? 0.55 : 1.1} />
      <directionalLight
        position={[-8, 24, 14]}
        intensity={night ? 0.5 : 1.6}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-20}
        shadow-camera-right={20}
        shadow-camera-top={20}
        shadow-camera-bottom={-20}
      />
      {/* The middle of the floor sits at the origin, where the camera looks */}
      <group ref={world} position={[-FLOOR_WIDTH / 2, 0, -FLOOR_DEPTH / 2]}>
        <Floor night={night} />
        {employees.map((employee) => (
          <Walker
            key={employee.role}
            employee={employee}
            event={events[employee.role] ?? null}
            still={reducedMotion}
            onMove={onMove}
          />
        ))}
      </group>
    </Canvas>
  );
}
