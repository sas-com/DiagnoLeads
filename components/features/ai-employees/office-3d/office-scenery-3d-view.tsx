'use client';

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  type InstancedMesh,
  Matrix4,
  PMREMGenerator,
  Quaternion,
  SRGBColorSpace,
  Vector3,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  BACK_WINDOWS,
  LEFT_WINDOWS,
  WALL_THICKNESS,
  WINDOW_SILL,
  WINDOW_TOP,
} from '../office-furniture';
import { AREA_RECTS, OFFICE_AREAS } from '../office-map-layout';
import {
  ROOM_LAMPS,
  ROOM_LIGHTS,
  type SceneryFinish,
  type SceneryPart,
  type SceneryShape,
  WALL_SCREENS,
  officeScenery,
} from './office-scenery-3d';
import { floorCanvas, poolCanvas, screenCanvas, skylineCanvas } from './office-textures-3d';

const UPRIGHT = new Quaternion();

/** A picture painted on a canvas, as a texture in the colours it was painted in */
function pictureOf(canvas: HTMLCanvasElement): CanvasTexture {
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** Frees the textures when the office is left */
function useDisposal(textures: readonly CanvasTexture[]): void {
  useEffect(
    () => () => {
      for (const texture of textures) texture.dispose();
    },
    [textures]
  );
}

function ShapeGeometry({ shape }: { shape: SceneryShape }) {
  switch (shape) {
    case 'cylinder':
      return <cylinderGeometry args={[0.5, 0.5, 1, 28]} />;
    case 'cone':
      return <cylinderGeometry args={[0.14, 0.5, 1, 28]} />;
    case 'ball':
      return <sphereGeometry args={[0.5, 20, 14]} />;
    default:
      return <boxGeometry args={[1, 1, 1]} />;
  }
}

function FinishMaterial({ finish }: { finish: SceneryFinish }) {
  switch (finish) {
    case 'glow':
      // Shines by itself: the same by day and by night, whatever the lamps do
      return <meshBasicMaterial toneMapped={false} />;
    case 'glass':
      return (
        <meshStandardMaterial
          transparent
          opacity={0.2}
          roughness={0.05}
          metalness={0.1}
          depthWrite={false}
        />
      );
    case 'metal':
      return <meshStandardMaterial metalness={0.95} roughness={0.34} />;
    case 'polished':
      return <meshStandardMaterial roughness={0.16} metalness={0.02} />;
    default:
      // Plaster, cloth, wood and leather. Their faces are flat and the camera never turns, so a
      // mirrored room would only tint each face evenly: the simple shading looks the same and
      // costs a fraction (measured on a machine without a graphics card, #1149)
      return <meshLambertMaterial />;
  }
}

/** All parts of one shape and finish, drawn in one call */
function Parts({
  parts,
  shape,
  finish,
  night,
}: {
  parts: readonly SceneryPart[];
  shape: SceneryShape;
  finish: SceneryFinish;
  night: boolean;
}) {
  const invalidate = useThree((state) => state.invalidate);
  const mesh = useRef<InstancedMesh>(null);

  useLayoutEffect(() => {
    const target = mesh.current;
    if (!target) return;
    const matrix = new Matrix4();
    const colour = new Color();
    parts.forEach((part, index) => {
      // The floor's y is the scene's z; up is the scene's y
      matrix.compose(
        new Vector3(part.x, part.z, part.y),
        UPRIGHT,
        new Vector3(part.w, part.h, part.d)
      );
      target.setMatrixAt(index, matrix);
      target.setColorAt(index, colour.set(night && part.night ? part.night : part.colour));
    });
    target.instanceMatrix.needsUpdate = true;
    if (target.instanceColor) target.instanceColor.needsUpdate = true;
    invalidate();
  }, [parts, night, invalidate]);

  const solid = finish !== 'glass' && finish !== 'glow';
  return (
    <instancedMesh
      ref={mesh}
      args={[undefined, undefined, parts.length]}
      castShadow={solid}
      receiveShadow={solid}
      // The parts are all over the floor: there is nothing to gain from testing the lot
      frustumCulled={false}
    >
      <ShapeGeometry shape={shape} />
      <FinishMaterial finish={finish} />
    </instancedMesh>
  );
}

/** The floors of the rooms: boards, carpet tiles and marble */
function Floors() {
  const textures = useMemo(
    () =>
      OFFICE_AREAS.map((area) =>
        pictureOf(floorCanvas(area, AREA_RECTS[area].w, AREA_RECTS[area].h))
      ),
    []
  );
  useDisposal(textures);
  return OFFICE_AREAS.map((area, index) => {
    const r = AREA_RECTS[area];
    return (
      <mesh
        key={area}
        position={[r.x + r.w / 2, 0, r.y + r.h / 2]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
      >
        <planeGeometry args={[r.w, r.h]} />
        {/* Flat, and seen from one side only: see FinishMaterial */}
        <meshLambertMaterial map={textures[index]} />
      </mesh>
    );
  });
}

/** A flat picture standing on a wall: facing the room from the back wall or from the left wall */
function OnWall({
  wall,
  from,
  to,
  z0,
  z1,
  off,
  picture,
}: {
  wall: 'back' | 'left';
  from: number;
  to: number;
  z0: number;
  z1: number;
  /** How far in front of the wall's inner face (behind it when negative) */
  off: number;
  picture: CanvasTexture | undefined;
}) {
  const middle = (from + to) / 2;
  const height = (z0 + z1) / 2;
  return (
    <mesh
      position={wall === 'back' ? [middle, height, off] : [off, height, middle]}
      rotation={[0, wall === 'back' ? 0 : Math.PI / 2, 0]}
    >
      <planeGeometry args={[to - from, z1 - z0]} />
      <meshBasicMaterial map={picture} toneMapped={false} />
    </mesh>
  );
}

const WINDOWS: readonly { wall: 'back' | 'left'; from: number; to: number }[] = [
  ...BACK_WINDOWS.map(([from, to]) => ({ wall: 'back' as const, from, to })),
  ...LEFT_WINDOWS.map(([from, to]) => ({ wall: 'left' as const, from, to })),
];

/** The city behind the windows, by day or by night */
function Skyline({ night }: { night: boolean }) {
  const pictures = useMemo(
    () =>
      WINDOWS.map(({ from, to }, index) =>
        pictureOf(skylineCanvas(to - from, WINDOW_TOP - WINDOW_SILL, night, index + 1))
      ),
    [night]
  );
  useDisposal(pictures);
  return WINDOWS.map((window, index) => (
    <OnWall
      key={`${window.wall}-${window.from}`}
      {...window}
      z0={WINDOW_SILL}
      z1={WINDOW_TOP}
      off={-WALL_THICKNESS * 0.75}
      picture={pictures[index]}
    />
  ));
}

/** What the wall screens show */
function Screens() {
  const pictures = useMemo(
    () =>
      WALL_SCREENS.map((screen) =>
        pictureOf(screenCanvas(screen.shows, screen.to - screen.from, screen.z1 - screen.z0))
      ),
    []
  );
  useDisposal(pictures);
  return WALL_SCREENS.map((screen, index) => (
    <OnWall
      key={`${screen.wall}-${screen.from}`}
      wall={screen.wall}
      from={screen.from + 0.06}
      to={screen.to - 0.06}
      z0={screen.z0 + 0.06}
      z1={screen.z1 - 0.06}
      off={screen.off}
      picture={pictures[index]}
    />
  ));
}

/** How far the pool of light under a pendant lamp reaches */
const POOL_RADIUS = 2.1;

/**
 * The lamps at night: a pool of warm light on the floor under each of them, and the light they
 * throw on the furniture and the robots, one light per part of the office
 */
function LampLight() {
  const pool = useMemo(() => pictureOf(poolCanvas()), []);
  const pools = useMemo(() => [pool], [pool]);
  useDisposal(pools);
  return (
    <>
      {ROOM_LAMPS.map((lamp) => (
        <mesh
          key={`${lamp.x}-${lamp.y}`}
          // Just over the floor and the rugs
          position={[lamp.x, 0.03, lamp.y]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <circleGeometry args={[POOL_RADIUS * (0.6 + 0.4 * lamp.strength), 40]} />
          <meshBasicMaterial
            map={pool}
            transparent
            opacity={0.36 * lamp.strength}
            blending={AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      ))}
      {ROOM_LIGHTS.map((light) => (
        <pointLight
          key={`${light.x}-${light.y}`}
          position={[light.x, light.z, light.y]}
          color="#ffd49a"
          intensity={16 * light.strength}
          distance={10}
          decay={1.6}
        />
      ))}
    </>
  );
}

const SHAPES: readonly SceneryShape[] = ['box', 'cylinder', 'cone', 'ball'];
const FINISHES: readonly SceneryFinish[] = ['matte', 'satin', 'polished', 'metal', 'glow', 'glass'];

/**
 * The office that does not move (#1149): the floors, the walls with the city behind their
 * windows, the furniture, the plants and the lamps, and at night the light of the lamps. In
 * floor units, inside the group that puts the floor under the camera.
 */
export function OfficeScenery({ night }: { night: boolean }) {
  const groups = useMemo(() => {
    const parts = officeScenery();
    return FINISHES.flatMap((finish) =>
      SHAPES.map((shape) => ({
        shape,
        finish,
        parts: parts.filter((part) => part.shape === shape && part.finish === finish),
      }))
    ).filter((group) => group.parts.length > 0);
  }, []);
  return (
    <group>
      <Floors />
      <Skyline night={night} />
      <Screens />
      {groups.map((group) => (
        <Parts key={`${group.finish}-${group.shape}`} {...group} night={night} />
      ))}
      {night && <LampLight />}
    </group>
  );
}

/**
 * The light from outside, in the scene's own axes (the middle of the floor is at the origin):
 * by day the sun stands behind the back walls, so it falls through the windows onto the floor
 * and the furniture throws its shadow towards the viewer; by night it is the moon, faint and
 * blue. A second light from the viewer's side keeps the faces turned to the viewer readable.
 */
export function OfficeDaylight({ night }: { night: boolean }) {
  return (
    <>
      <hemisphereLight
        args={[night ? '#5d6fae' : '#eef5ff', night ? '#161922' : '#b7a58a', night ? 0.28 : 0.32]}
      />
      <directionalLight
        position={[-9, 15, -11]}
        color={night ? '#a9bcff' : '#fff0d2'}
        intensity={night ? 0.4 : 1.55}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.04}
      >
        {/* The whole floor throws and takes shadows: a camera of its own, made at that size */}
        <orthographicCamera attach="shadow-camera" args={[-17, 17, 17, -17, 1, 60]} />
      </directionalLight>
      <directionalLight
        position={[11, 9, 7]}
        color={night ? '#c9d4ff' : '#ffffff'}
        intensity={night ? 0.12 : 0.32}
      />
    </>
  );
}

/**
 * What the polished surfaces mirror (brass, marble, glass, steel): the soft light of a room,
 * made in the browser (no picture is loaded), dimmer at night
 */
export function OfficeReflections({ night }: { night: boolean }) {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const invalidate = useThree((state) => state.invalidate);

  useEffect(() => {
    const generator = new PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const surroundings = generator.fromScene(room, 0.04);
    scene.environment = surroundings.texture;
    invalidate();
    return () => {
      scene.environment = null;
      surroundings.dispose();
      room.dispose();
      generator.dispose();
    };
  }, [gl, scene, invalidate]);

  useEffect(() => {
    scene.environmentIntensity = night ? 0.12 : 0.32;
    invalidate();
  }, [scene, night, invalidate]);

  return null;
}

/** How many frames pass between two drawings of the shadows while nobody walks */
const SHADOW_EVERY = 20;

/**
 * Draws the shadows again only when it shows: every frame while somebody walks, and now and
 * then otherwise (a robot at its desk sways a little; its shadow may follow a moment later).
 * Nearly everything that throws a shadow stands still, and drawing them all again is the
 * dearest part of a frame.
 */
export function OfficeShadowPace({ walking }: { walking: () => boolean }) {
  const gl = useThree((state) => state.gl);
  const frames = useRef(0);

  useEffect(() => {
    gl.shadowMap.autoUpdate = false;
    gl.shadowMap.needsUpdate = true;
    return () => {
      gl.shadowMap.autoUpdate = true;
    };
  }, [gl]);

  useFrame(() => {
    frames.current += 1;
    // The first frames always: the scenery and the lights arrive one after the other
    if (walking() || frames.current < 10 || frames.current % SHADOW_EVERY === 0) {
      gl.shadowMap.needsUpdate = true;
    }
  });
  return null;
}
