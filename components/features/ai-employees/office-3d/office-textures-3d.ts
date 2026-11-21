/**
 * The pictures the 3D office puts on its flat surfaces (#1149), painted on a canvas in the
 * browser: the floors (oak and walnut boards, carpet tiles, marble slabs), the city behind the
 * windows by day and by night, and what the wall screens show. Painted, not loaded: no file and
 * no request, so the site's content policy stays as it is.
 *
 * The same picture every time: the "random" grain comes from a fixed seed.
 */
import type { OfficeArea } from '../office-map-layout';

/** A stream of numbers between 0 and 1 that is always the same for the same seed */
function seeded(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    // xorshift32
    state ^= state << 13;
    state >>>= 0;
    state ^= state >> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0xffffffff;
  };
}

function canvasOf(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(2, Math.round(width));
  canvas.height = Math.max(2, Math.round(height));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('No 2D canvas for the textures of the office');
  return [canvas, context];
}

/** The colour made lighter (above 1) or darker (below 1) */
function toned(hex: string, by: number): string {
  const channel = (at: number) =>
    Math.max(0, Math.min(255, Math.round(Number.parseInt(hex.slice(at, at + 2), 16) * by)));
  return `rgb(${channel(1)}, ${channel(3)}, ${channel(5)})`;
}

/** Pixels per floor unit of a floor */
const FLOOR_PX = 64;

/** Fine grain over the whole canvas, so that a floor is not one flat colour */
function grain(
  g: CanvasRenderingContext2D,
  width: number,
  height: number,
  next: () => number,
  strength: number
): void {
  const specks = Math.round((width * height) / 90);
  for (let i = 0; i < specks; i++) {
    g.fillStyle = next() > 0.5 ? `rgba(255,255,255,${strength})` : `rgba(0,0,0,${strength})`;
    g.fillRect(next() * width, next() * height, 1 + next() * 2, 1 + next() * 2);
  }
}

/** Boards laid along x, each a little different, with dark joints */
function boards(
  g: CanvasRenderingContext2D,
  width: number,
  height: number,
  next: () => number,
  colour: string,
  joint: string,
  boardWidth: number
): void {
  const step = boardWidth * FLOOR_PX;
  for (let y = 0; y < height; y += step) {
    let x = -next() * 2 * FLOOR_PX;
    while (x < width) {
      const length = (1.6 + next() * 1.8) * FLOOR_PX;
      g.fillStyle = toned(colour, 0.93 + next() * 0.14);
      g.fillRect(x, y, length, step);
      // The grain of the wood: a few faint streaks along the board
      g.strokeStyle = 'rgba(60,35,15,0.07)';
      g.lineWidth = 1;
      for (let i = 0; i < 3; i++) {
        const at = y + (0.15 + next() * 0.7) * step;
        g.beginPath();
        g.moveTo(x + 4, at);
        g.bezierCurveTo(x + length * 0.3, at + 2, x + length * 0.6, at - 2, x + length - 4, at);
        g.stroke();
      }
      g.fillStyle = joint;
      g.fillRect(x + length - 1, y, 1.5, step);
      x += length;
    }
    g.fillStyle = joint;
    g.fillRect(0, y, width, 1.5);
  }
}

/** Square tiles of carpet or stone, alternating a little, with joints */
function tiles(
  g: CanvasRenderingContext2D,
  width: number,
  height: number,
  next: () => number,
  colour: string,
  joint: string,
  side: number,
  spread: number
): void {
  const step = side * FLOOR_PX;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      g.fillStyle = toned(colour, 1 - spread / 2 + next() * spread);
      g.fillRect(x, y, step, step);
    }
  }
  g.fillStyle = joint;
  for (let y = 0; y < height; y += step) g.fillRect(0, y, width, 1.2);
  for (let x = 0; x < width; x += step) g.fillRect(x, 0, 1.2, height);
}

/** Grey veins wandering over marble */
function veins(g: CanvasRenderingContext2D, width: number, height: number, next: () => number) {
  const count = Math.round((width * height) / 26000);
  for (let i = 0; i < count; i++) {
    let x = next() * width;
    let y = next() * height;
    g.strokeStyle = `rgba(120,112,100,${0.1 + next() * 0.16})`;
    g.lineWidth = 0.6 + next() * 1.4;
    g.beginPath();
    g.moveTo(x, y);
    for (let step = 0; step < 5; step++) {
      x += (next() - 0.3) * 70;
      y += (next() - 0.5) * 46;
      g.lineTo(x, y);
    }
    g.stroke();
  }
}

/**
 * The floor of an area, `w` by `h` floor units: the canvas' x is the floor's x, its y the
 * floor's y
 */
export function floorCanvas(area: OfficeArea, w: number, h: number): HTMLCanvasElement {
  const width = w * FLOOR_PX;
  const height = h * FLOOR_PX;
  const [canvas, g] = canvasOf(width, height);
  const next = seeded(area.length * 7919 + w * 131 + h);
  switch (area) {
    case 'sales':
    case 'engineering':
      boards(g, width, height, next, '#dcc7a6', 'rgba(150,120,80,0.55)', 0.5);
      grain(g, width, height, next, 0.025);
      break;
    case 'lounge':
      boards(g, width, height, next, '#a9825c', 'rgba(90,60,35,0.6)', 0.4);
      grain(g, width, height, next, 0.03);
      break;
    case 'marketing':
      tiles(g, width, height, next, '#d3d8de', 'rgba(140,150,162,0.5)', 1, 0.05);
      grain(g, width, height, next, 0.05);
      break;
    case 'training':
      tiles(g, width, height, next, '#d9dfe8', 'rgba(150,160,176,0.5)', 1, 0.05);
      grain(g, width, height, next, 0.05);
      break;
    case 'charging':
      tiles(g, width, height, next, '#c9ced5', 'rgba(120,128,140,0.55)', 2, 0.03);
      grain(g, width, height, next, 0.04);
      break;
    default:
      // Marble slabs with veins in the corridor and the reception
      tiles(g, width, height, next, '#f0eee9', 'rgba(170,164,154,0.7)', 2, 0.035);
      veins(g, width, height, next);
      grain(g, width, height, next, 0.015);
  }
  return canvas;
}

/** Pixels per floor unit of a window */
const WINDOW_PX = 96;

/**
 * What is seen through a window `w` wide and `h` high: the sky and the city, by day or by
 * night. The seed makes every window show another stretch of the city.
 */
export function skylineCanvas(
  w: number,
  h: number,
  night: boolean,
  seed: number
): HTMLCanvasElement {
  const width = w * WINDOW_PX;
  const height = h * WINDOW_PX;
  const [canvas, g] = canvasOf(width, height);
  const next = seeded(seed * 104729 + 17);
  const sky = g.createLinearGradient(0, 0, 0, height);
  if (night) {
    sky.addColorStop(0, '#060b1f');
    sky.addColorStop(0.6, '#12204a');
    sky.addColorStop(1, '#26386e');
  } else {
    sky.addColorStop(0, '#5fa8e8');
    sky.addColorStop(0.55, '#b5dbf6');
    sky.addColorStop(1, '#eef8fe');
  }
  g.fillStyle = sky;
  g.fillRect(0, 0, width, height);
  if (night) {
    for (let i = 0; i < 46; i++) {
      g.fillStyle = `rgba(255,255,255,${0.35 + next() * 0.6})`;
      g.fillRect(next() * width, next() * height * 0.55, 1.4, 1.4);
    }
  } else {
    // A few soft clouds
    for (let i = 0; i < 3; i++) {
      const x = next() * width;
      const y = (0.08 + next() * 0.3) * height;
      const cloud = g.createRadialGradient(x, y, 2, x, y, 70 + next() * 50);
      cloud.addColorStop(0, 'rgba(255,255,255,0.85)');
      cloud.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = cloud;
      g.fillRect(x - 130, y - 40, 260, 80);
    }
  }
  // The city: a far row in the haze, a near row in front of it
  const rows = [
    { colour: night ? '#0d1733' : '#bcd2e8', low: 0.22, high: 0.5, lit: 0.18 },
    { colour: night ? '#111b36' : '#9db8d4', low: 0.14, high: 0.68, lit: 0.34 },
  ];
  for (const row of rows) {
    let x = -next() * 20;
    while (x < width) {
      const wide = (0.3 + next() * 0.28) * WINDOW_PX;
      const tall = (row.low + next() * (row.high - row.low)) * height;
      const top = height - tall;
      g.fillStyle = row.colour;
      g.fillRect(x, top, wide - 3, tall);
      // Its windows: lit at night, a faint grid by day
      for (let wy = top + 6; wy < height - 4; wy += 9) {
        for (let wx = x + 4; wx < x + wide - 8; wx += 7) {
          if (night) {
            if (next() < row.lit) {
              g.fillStyle = next() < 0.8 ? 'rgba(255,217,138,0.9)' : 'rgba(190,225,255,0.85)';
              g.fillRect(wx, wy, 3.2, 4.4);
            }
          } else {
            g.fillStyle = 'rgba(255,255,255,0.22)';
            g.fillRect(wx, wy, 3.2, 4.4);
          }
        }
      }
      x += wide;
    }
  }
  // Haze over the foot of the city
  const haze = g.createLinearGradient(0, height * 0.7, 0, height);
  haze.addColorStop(0, 'rgba(255,255,255,0)');
  haze.addColorStop(1, night ? 'rgba(40,60,120,0.35)' : 'rgba(255,255,255,0.45)');
  g.fillStyle = haze;
  g.fillRect(0, height * 0.7, width, height * 0.3);
  return canvas;
}

/** What a wall screen shows: a rising line chart, or a slide with a heading and a line of text */
export function screenCanvas(shows: 'chart' | 'slide', w: number, h: number): HTMLCanvasElement {
  const width = w * WINDOW_PX;
  const height = h * WINDOW_PX;
  const [canvas, g] = canvasOf(width, height);
  g.fillStyle = '#0b1220';
  g.fillRect(0, 0, width, height);
  if (shows === 'chart') {
    g.strokeStyle = 'rgba(148,163,184,0.16)';
    g.lineWidth = 1;
    for (let i = 1; i < 5; i++) {
      g.beginPath();
      g.moveTo(width * 0.05, (height * i) / 5);
      g.lineTo(width * 0.95, (height * i) / 5);
      g.stroke();
    }
    // The line of the 2D office's chart, in the same proportions
    const points: readonly (readonly [number, number])[] = [
      [0.06, 0.79],
      [0.26, 0.58],
      [0.44, 0.67],
      [0.62, 0.36],
      [0.82, 0.45],
      [0.94, 0.15],
    ];
    const under = g.createLinearGradient(0, 0, 0, height);
    under.addColorStop(0, 'rgba(52,211,153,0.35)');
    under.addColorStop(1, 'rgba(52,211,153,0)');
    g.beginPath();
    g.moveTo(width * 0.06, height * 0.95);
    for (const [x, y] of points) g.lineTo(width * x, height * y);
    g.lineTo(width * 0.94, height * 0.95);
    g.closePath();
    g.fillStyle = under;
    g.fill();
    g.beginPath();
    points.forEach(([x, y], index) => {
      if (index === 0) g.moveTo(width * x, height * y);
      else g.lineTo(width * x, height * y);
    });
    g.strokeStyle = '#34d399';
    g.lineWidth = 4;
    g.lineJoin = 'round';
    g.stroke();
  } else {
    g.fillStyle = '#2452c9';
    g.fillRect(width * 0.075, height * 0.16, width * 0.85, height * 0.68);
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.fillRect(width * 0.2, height * 0.42, width * 0.55, height * 0.035);
    g.fillStyle = 'rgba(255,255,255,0.5)';
    g.fillRect(width * 0.2, height * 0.58, width * 0.35, height * 0.028);
  }
  return canvas;
}

/** The pool of light under a lamp: warm in the middle, fading out to nothing */
export function poolCanvas(): HTMLCanvasElement {
  const size = 256;
  const [canvas, g] = canvasOf(size, size);
  const light = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  light.addColorStop(0, 'rgba(255,214,150,1)');
  light.addColorStop(0.35, 'rgba(255,205,135,0.55)');
  light.addColorStop(1, 'rgba(255,200,120,0)');
  g.fillStyle = light;
  g.fillRect(0, 0, size, size);
  return canvas;
}
