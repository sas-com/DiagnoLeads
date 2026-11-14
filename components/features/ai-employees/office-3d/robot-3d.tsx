'use client';

import type { DeskStatus } from '@/lib/features/ai-employees/office';
import {
  type AiTone,
  DEFAULT_ROBOT_LOOK,
  type RobotLook,
} from '@/lib/features/ai-employees/types/profile';
import type { AiEmployeeRole } from '@/lib/features/ai-employees/types/roles';
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import { CanvasTexture, type Group, SRGBColorSpace } from 'three';
import { STATUS_LIGHT, shade } from '../office-prims';
import { ROBOT_SHELL_COLORS, ROLE_GEARS, robotAccent } from '../office-robot';
import { type EmoteIcon, type Emotion, expressionOf, gestureScale } from './office-emotion';

const DARK = '#1f2937';
const VISOR = '#111827';
const EYE = '#67e8f9';
const EYE_ALERT = '#fcd34d';

/** What floats over the head for each icon */
const ICON_TEXT: Readonly<Record<Exclude<EmoteIcon, 'none'>, string>> = {
  check: '✓',
  alert: '!',
  sleep: 'Zzz',
  wave: '♪',
  // Drawn, not written: three dots read as "waiting", not as "studying"
  book: '',
};
const ICON_COLORS: Readonly<Record<Exclude<EmoteIcon, 'none'>, string>> = {
  check: '#16a34a',
  alert: '#dc2626',
  sleep: '#475569',
  wave: '#db2777',
  book: '#2563eb',
};

/** A round badge with a glyph, drawn once into a texture */
function useBadge(text: string, colour: string) {
  return useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const context = canvas.getContext('2d');
    if (context) {
      context.fillStyle = '#ffffff';
      context.beginPath();
      context.arc(64, 64, 58, 0, Math.PI * 2);
      context.fill();
      context.lineWidth = 6;
      context.strokeStyle = colour;
      context.stroke();
      context.fillStyle = colour;
      if (!text) {
        // A mortarboard, like the cap the robots wear on the 2D floor while they study
        context.beginPath();
        context.moveTo(64, 30);
        context.lineTo(110, 52);
        context.lineTo(64, 74);
        context.lineTo(18, 52);
        context.closePath();
        context.fill();
        context.beginPath();
        context.moveTo(38, 68);
        context.lineTo(38, 88);
        context.quadraticCurveTo(64, 104, 90, 88);
        context.lineTo(90, 68);
        context.lineTo(64, 80);
        context.closePath();
        context.fill();
        context.fillRect(104, 54, 5, 30);
      }
      context.font = `bold ${text.length > 1 ? 44 : 78}px sans-serif`;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(text, 64, 68);
    }
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    return texture;
  }, [text, colour]);
}

function Emote({ icon }: { icon: Exclude<EmoteIcon, 'none'> }) {
  const texture = useBadge(ICON_TEXT[icon], ICON_COLORS[icon]);
  return (
    <sprite position={[0.55, 2.55, 0]} scale={[0.62, 0.62, 0.62]}>
      <spriteMaterial map={texture} depthTest={false} />
    </sprite>
  );
}

/** One eye on the visor, in the shape the emotion gives it */
function Eye({
  x,
  shape,
  colour,
  wide,
}: { x: number; shape: string; colour: string; wide: boolean }) {
  const material = <meshBasicMaterial color={colour} toneMapped={false} />;
  const size = wide ? 0.105 : 0.08;
  if (shape === 'closed') {
    return (
      <mesh position={[x, 0, 0]}>
        <boxGeometry args={[0.17, 0.028, 0.02]} />
        {material}
      </mesh>
    );
  }
  if (shape === 'arc') {
    // A smiling arc: the upper half of a ring
    return (
      <mesh position={[x, -0.03, 0]}>
        <torusGeometry args={[0.075, 0.022, 8, 16, Math.PI]} />
        {material}
      </mesh>
    );
  }
  return (
    <mesh
      position={[x, 0, 0]}
      rotation={[0, 0, shape === 'down' ? (x < 0 ? -0.5 : 0.5) : 0]}
      scale={[1, shape === 'narrow' ? 0.45 : shape === 'down' ? 0.6 : 1.2, 0.4]}
    >
      <sphereGeometry args={[size, 16, 12]} />
      {material}
    </mesh>
  );
}

/**
 * A robot of the AI office in 3D (#1135, spike), built in code from the same look as the 2D
 * robot (#1134): head, eyes, antenna, gear, shell and accent colours. The chest keeps a dark
 * panel for the role's emblem and the beacon over the head shows the status whatever the antenna.
 *
 * It hovers; while it walks it leans forward and swings its arms; its emotion shows in its eyes,
 * in how it bobs and leans, and in the badge over its head. The personality scales the gestures.
 * The origin is on the floor under the robot; it faces +z. About 2.2 units tall.
 */
export function Robot3D({
  role,
  status,
  look = DEFAULT_ROBOT_LOOK,
  emotion,
  tone,
  walking,
  still = false,
}: {
  role: AiEmployeeRole;
  status: Exclude<DeskStatus, 'vacant'>;
  look?: RobotLook;
  emotion: Emotion;
  tone: AiTone;
  walking: boolean;
  /** Less motion: the pose of the emotion is kept, but nothing hovers, sways or waves */
  still?: boolean;
}) {
  const body = useRef<Group>(null);
  const head = useRef<Group>(null);
  const leftArm = useRef<Group>(null);
  const rightArm = useRef<Group>(null);
  const expression = expressionOf(emotion);
  const gesture = gestureScale(tone);
  const off = status === 'paused';
  const coat = ROBOT_SHELL_COLORS[look.shell];
  const shell = off ? shade(coat, 0.72) : coat;
  const accent = off ? shade(robotAccent(role, look), 0.7) : robotAccent(role, look);
  const eye = status === 'attention' ? EYE_ALERT : EYE;
  const gear = look.gear === 'role' ? ROLE_GEARS[role] : look.gear;
  const eyes = off ? 'closed' : expression.eyes;

  useFrame(({ clock }) => {
    // Time stands still for people who ask for less motion: every swing below rests at zero
    const t = still ? 0 : clock.elapsedTime;
    const bob = 0.035 * expression.bob * gesture;
    if (body.current) {
      // Hovering, a little faster and higher with a lively emotion
      body.current.position.y = 0.16 + Math.sin(t * (2 + expression.bob * 0.6)) * bob;
      body.current.rotation.x = (walking ? 0.16 : 0) + expression.lean * 0.5;
    }
    if (head.current) {
      head.current.rotation.x = expression.lean;
      // Looking around a little while waiting; still while asleep or focused
      head.current.rotation.y =
        emotion === 'relaxed' || emotion === 'attentive' ? Math.sin(t * 0.7) * 0.25 * gesture : 0;
    }
    const swing = walking ? Math.sin(t * 7) * 0.55 * gesture : 0;
    // A wave: the near arm goes up and waves
    // (with less motion the arm stays raised, without waving)
    const wave = emotion === 'happy' || emotion === 'proud' ? -2.2 + Math.sin(t * 9) * 0.35 : 0;
    if (leftArm.current) leftArm.current.rotation.x = swing;
    if (rightArm.current) {
      rightArm.current.rotation.x = wave ? 0 : -swing;
      rightArm.current.rotation.z = wave;
    }
  });

  const shellMaterial = <meshStandardMaterial color={shell} roughness={0.45} metalness={0.05} />;
  const headTop = look.head === 'dome' ? 0.5 : 0.36;
  const beaconY = look.antenna === 'none' ? headTop + 0.07 : headTop + 0.3;

  return (
    <group>
      {/* The glow under the hovering base */}
      {!off && (
        <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[0.5, 32]} />
          <meshBasicMaterial color={accent} transparent opacity={0.35} toneMapped={false} />
        </mesh>
      )}
      <group ref={body}>
        {/* The base with its light strip */}
        <mesh position={[0, 0.13, 0]} castShadow>
          <cylinderGeometry args={[0.36, 0.44, 0.22, 32]} />
          <meshStandardMaterial color="#2b313a" roughness={0.6} />
        </mesh>
        <mesh position={[0, 0.1, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.43, 0.03, 8, 32]} />
          <meshBasicMaterial color={accent} toneMapped={false} />
        </mesh>
        {/* The egg-shaped body */}
        <mesh position={[0, 0.78, 0]} scale={[1, 1.25, 0.92]} castShadow>
          <sphereGeometry args={[0.46, 32, 24]} />
          {shellMaterial}
        </mesh>
        {/* The chest panel, where the role's emblem goes, and the power light */}
        <mesh position={[-0.08, 0.86, 0.39]} rotation={[-0.12, 0, 0]}>
          <boxGeometry args={[0.36, 0.3, 0.06]} />
          <meshStandardMaterial color={DARK} roughness={0.4} />
        </mesh>
        <mesh position={[0.2, 0.9, 0.4]}>
          <sphereGeometry args={[0.04, 12, 8]} />
          <meshBasicMaterial color={off ? '#6b7280' : '#22c55e'} toneMapped={false} />
        </mesh>
        {/* The collar */}
        <mesh position={[0, 1.28, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.24, 0.055, 10, 24]} />
          <meshStandardMaterial color={accent} roughness={0.5} />
        </mesh>
        {gear === 'bow_tie' && (
          <group position={[0, 1.2, 0.3]}>
            <mesh position={[-0.11, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
              <coneGeometry args={[0.09, 0.2, 4]} />
              <meshStandardMaterial color={accent} />
            </mesh>
            <mesh position={[0.11, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
              <coneGeometry args={[0.09, 0.2, 4]} />
              <meshStandardMaterial color={accent} />
            </mesh>
            <mesh>
              <sphereGeometry args={[0.045, 12, 8]} />
              <meshStandardMaterial color={DARK} />
            </mesh>
          </group>
        )}
        {/* The arms hang from the shoulders and swing from there */}
        {[
          { ref: leftArm, x: -0.5 },
          { ref: rightArm, x: 0.5 },
        ].map((arm) => (
          <group key={arm.x} ref={arm.ref} position={[arm.x, 1.08, 0]}>
            <mesh position={[0, -0.26, 0]} castShadow>
              <capsuleGeometry args={[0.075, 0.4, 6, 12]} />
              {shellMaterial}
            </mesh>
            <mesh position={[0, -0.56, 0]}>
              <sphereGeometry args={[0.095, 12, 10]} />
              <meshStandardMaterial color="#3b424d" />
            </mesh>
          </group>
        ))}

        {/* The head */}
        <group ref={head} position={[0, 1.68, 0]}>
          {look.head === 'round' ? (
            <mesh castShadow>
              <sphereGeometry args={[0.42, 32, 24]} />
              {shellMaterial}
            </mesh>
          ) : look.head === 'dome' ? (
            <mesh position={[0, 0.06, 0]} castShadow>
              <capsuleGeometry args={[0.38, 0.22, 10, 24]} />
              {shellMaterial}
            </mesh>
          ) : (
            <mesh scale={look.head === 'square' ? [1, 1, 1] : [1, 0.92, 0.95]} castShadow>
              <boxGeometry args={look.head === 'square' ? [0.8, 0.68, 0.7] : [0.84, 0.72, 0.74]} />
              {shellMaterial}
            </mesh>
          )}
          {/* The visor and the eyes */}
          <mesh position={[0, 0.02, look.head === 'round' ? 0.33 : 0.37]}>
            <boxGeometry args={[0.62, 0.34, 0.08]} />
            <meshStandardMaterial color={VISOR} roughness={0.2} metalness={0.3} />
          </mesh>
          <group position={[0, 0.03, look.head === 'round' ? 0.38 : 0.42]}>
            {look.eyes === 'bar' && eyes !== 'closed' ? (
              <mesh rotation={[0, 0, eyes === 'down' ? 0.12 : 0]}>
                <boxGeometry args={[0.44, eyes === 'narrow' ? 0.04 : 0.07, 0.02]} />
                <meshBasicMaterial color={eye} toneMapped={false} />
              </mesh>
            ) : (
              <>
                <Eye x={-0.14} shape={eyes} colour={eye} wide={look.eyes === 'wide'} />
                <Eye x={0.14} shape={eyes} colour={eye} wide={look.eyes === 'wide'} />
              </>
            )}
          </group>
          {/* The ears */}
          {[-1, 1].map((side) => (
            <mesh key={side} position={[side * 0.44, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[0.11, 0.11, 0.06, 20]} />
              <meshStandardMaterial color={accent} roughness={0.5} />
            </mesh>
          ))}
          {/* The antenna and the status beacon */}
          {look.antenna !== 'none' && (
            <mesh position={[0.14, headTop + 0.13, 0]}>
              <cylinderGeometry args={[0.014, 0.014, 0.26, 8]} />
              <meshStandardMaterial color="#8b95a3" />
            </mesh>
          )}
          {look.antenna === 'double' && (
            <>
              <mesh position={[-0.14, headTop + 0.09, 0]}>
                <cylinderGeometry args={[0.014, 0.014, 0.18, 8]} />
                <meshStandardMaterial color="#8b95a3" />
              </mesh>
              <mesh position={[-0.14, headTop + 0.2, 0]}>
                <sphereGeometry args={[0.045, 12, 8]} />
                <meshStandardMaterial color={accent} />
              </mesh>
            </>
          )}
          {look.antenna === 'ring' && (
            <mesh position={[0.14, beaconY, 0]} rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[0.15, 0.018, 8, 24]} />
              <meshStandardMaterial color={accent} />
            </mesh>
          )}
          <mesh position={[0.14, beaconY, 0]}>
            <sphereGeometry args={[look.antenna === 'none' ? 0.06 : 0.08, 16, 12]} />
            <meshBasicMaterial color={STATUS_LIGHT[status]} toneMapped={false} />
          </mesh>
          {/* The gear */}
          {gear === 'headset' && (
            <>
              <mesh rotation={[0, 0, 0]} position={[0, 0.02, 0]}>
                <torusGeometry args={[0.46, 0.03, 8, 24, Math.PI]} />
                <meshStandardMaterial color={DARK} />
              </mesh>
              <mesh position={[0.3, -0.2, 0.36]}>
                <sphereGeometry args={[0.05, 12, 8]} />
                <meshStandardMaterial color={accent} />
              </mesh>
            </>
          )}
          {gear === 'scanner' && (
            <mesh position={[-0.1, headTop + 0.04, 0.05]}>
              <boxGeometry args={[0.34, 0.1, 0.2]} />
              <meshStandardMaterial color={DARK} emissive={accent} emissiveIntensity={0.5} />
            </mesh>
          )}
          {gear === 'goggles' &&
            [-0.15, 0.15].map((x) => (
              <mesh key={x} position={[x, 0.3, 0.33]} rotation={[Math.PI / 2 - 0.5, 0, 0]}>
                <cylinderGeometry args={[0.11, 0.11, 0.08, 20]} />
                <meshStandardMaterial color={DARK} emissive={accent} emissiveIntensity={0.35} />
              </mesh>
            ))}
          {gear === 'eyeshade' && (
            <mesh position={[0, 0.24, 0.42]} rotation={[0.25, 0, 0]}>
              <boxGeometry args={[0.8, 0.04, 0.34]} />
              <meshStandardMaterial color={accent} />
            </mesh>
          )}
        </group>
      </group>
      {expression.icon !== 'none' && <Emote icon={expression.icon} />}
    </group>
  );
}
