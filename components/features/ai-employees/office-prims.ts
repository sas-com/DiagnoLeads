/**
 * The SVG primitives the virtual office is drawn with (Refs #1101), shared by the scene
 * (office-scene.ts), the robots (office-robot.ts) and the renderer (office-scene-svg.tsx).
 */
import type { DeskStatus } from '@/lib/features/ai-employees/office';

export interface PrimStyle {
  fill: string;
  op?: number;
  stroke?: string;
  /** Stroke width; a stroke with a width gets round caps and joins (limbs, cables) */
  sw?: number;
  filter?: 'soft' | 'glow';
  /** Pulses for people who do not ask for reduced motion */
  pulse?: boolean;
}

export type ScenePrim =
  | ({ kind: 'poly'; points: string } & PrimStyle)
  | ({ kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number } & PrimStyle)
  | ({ kind: 'path'; d: string } & PrimStyle);

/** Gradients the drawings refer to by name; the renderer defines them under its own ids */
export const SCENE_GRADIENTS = ['sky', 'bodyOn', 'headOn', 'bodyOff', 'headOff', 'pool'] as const;
export type SceneGradient = (typeof SCENE_GRADIENTS)[number];

/** The colour of the beacon on a robot's antenna */
export const STATUS_LIGHT: Record<DeskStatus, string> = {
  working: '#22c55e',
  attention: '#ef4444',
  idle: '#38bdf8',
  training: '#f59e0b',
  paused: '#6b7280',
  vacant: '#9ca3af',
};

function channels(hex: string): number[] {
  return [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
}

function toHex(values: number[]): string {
  return `#${values
    .map((value) =>
      Math.max(0, Math.min(255, Math.round(value)))
        .toString(16)
        .padStart(2, '0')
    )
    .join('')}`;
}

/** A darker (factor below 1) or lighter shade of a colour */
export function shade(hex: string, factor: number): string {
  return toHex(channels(hex).map((value) => value * factor));
}

/** A colour mixed with white: 0 leaves it, 1 is white */
export function tint(hex: string, amount: number): string {
  return toHex(channels(hex).map((value) => value + (255 - value) * amount));
}
