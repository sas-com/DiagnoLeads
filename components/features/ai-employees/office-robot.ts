/**
 * The robots of the AI office (Refs #1101): one original design, the "desk companion", with a
 * build of its own per role so each AI employee is told apart at a glance.
 *
 * The common build: a hovering base with a light strip, an egg-shaped ceramic body with a seam,
 * a dark chest panel that carries the role's emblem, jointed arms, a wide helmet head with a
 * glass visor and LED eyes, a sensor disc on the ear and an antenna whose beacon shows the
 * status. Per role:
 * - marketer (violet): a scanner bar on the head and a lens over one eye, a gauge on the chest
 * - sales (teal): a headset with a microphone, a checklist on the chest
 * - engineer (blue): goggles pushed up on the forehead, code brackets on the chest
 * - back office (orange): a bookkeeper's eyeshade with a peak, a clock on the chest
 *
 * The robot is drawn turned three-quarters towards what it faces (its desk, a table): 'left' is
 * towards the viewer's lower left (the floor's +y), 'right' the mirror image (the floor's +x).
 * Its pose follows the status: hands forward on the desk while working or studying, a cup in the
 * hand while waiting, arms down otherwise. Pure: returns primitives around the feet at (x, y).
 *
 * An AI employee can be customized (#1134): the shape of the head, the eyes, the antenna, the
 * equipment and the colours of the shell and of the accent follow its look. The emblem on the
 * chest stays the role's, so the role is still told at a glance. Without a look, the robot is the
 * role's own build described above.
 */
import type { DeskStatus } from '@/lib/features/ai-employees/office';
import {
  DEFAULT_ROBOT_LOOK,
  type RobotAccent,
  type RobotGear,
  type RobotLook,
  type RobotShell,
} from '@/lib/features/ai-employees/types/profile';
import type { AiEmployeeRole } from '@/lib/features/ai-employees/types/roles';
import type { RobotFacing } from './office-map-layout';
import {
  type PrimStyle,
  STATUS_LIGHT,
  type SceneGradient,
  type ScenePrim,
  shade,
  tint,
} from './office-prims';

/** The colour of each role's collar, light strip and equipment */
export const ROLE_ACCENTS: Readonly<Record<AiEmployeeRole, string>> = {
  marketer: '#7c3aed',
  sales: '#0d9488',
  engineer: '#2563eb',
  back_office: '#ea580c',
};

/** The accent colours a look can choose instead of the role's */
export const ROBOT_ACCENT_COLORS: Readonly<Record<Exclude<RobotAccent, 'role'>, string>> = {
  violet: '#7c3aed',
  teal: '#0d9488',
  blue: '#2563eb',
  orange: '#ea580c',
  pink: '#db2777',
  lime: '#65a30d',
  gold: '#ca8a04',
  red: '#dc2626',
};

/** The shell colours of a look; 'white' is the ceramic shell with its own shading */
export const ROBOT_SHELL_COLORS: Readonly<Record<RobotShell, string>> = {
  white: '#f4f6f9',
  silver: '#cfd6de',
  graphite: '#4b5563',
  sand: '#eadfc8',
  mint: '#cfeee0',
  sky: '#cfe6fb',
  rose: '#f9d5dc',
};

/** The equipment each role wears unless the look chooses another */
export const ROLE_GEARS: Readonly<Record<AiEmployeeRole, Exclude<RobotGear, 'role'>>> = {
  marketer: 'scanner',
  sales: 'headset',
  engineer: 'goggles',
  back_office: 'eyeshade',
};

/** The accent colour of a robot: the look's, or the role's */
export function robotAccent(role: AiEmployeeRole, look: RobotLook = DEFAULT_ROBOT_LOOK): string {
  return look.accent === 'role' ? ROLE_ACCENTS[role] : ROBOT_ACCENT_COLORS[look.accent];
}

/** How far the drawing reaches around the feet: for the portrait's box and the scene's margins */
export const ROBOT_EXTENT = { left: 36, right: 50, top: 114, bottom: 10 } as const;

type Style = Omit<PrimStyle, 'fill'>;
type Token = string | number;

export function robotPrims(input: {
  role: AiEmployeeRole;
  status: DeskStatus;
  x: number;
  y: number;
  facing: RobotFacing;
  night: boolean;
  gradient: (name: SceneGradient) => string;
  /** How the employee was customized; the role's own build when left out */
  look?: RobotLook;
}): ScenePrim[] {
  const { role, status, x: X, y: Y, night, gradient } = input;
  const look = input.look ?? DEFAULT_ROBOT_LOOK;
  const gear = look.gear === 'role' ? ROLE_GEARS[role] : look.gear;
  const m = input.facing === 'left' ? 1 : -1;
  const off = status === 'paused';
  const ghost = status === 'vacant';
  /** Everything of a vacant desk's robot is a faint outline of who would sit there */
  const o = (value = 1) => (ghost ? 0.28 : 1) * value;

  // Shapes in the robot's own coordinates (x to its left hand side on the screen, y up negative),
  // mirrored when it faces right
  const d = (tokens: readonly Token[]) => {
    let out = '';
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (typeof token === 'string') out += token;
      else {
        out += `${(X + m * token).toFixed(1)} ${(Y + (tokens[i + 1] as number)).toFixed(1)} `;
        i += 1;
      }
    }
    return out.trim();
  };
  const path = (tokens: readonly Token[], fill: string, style: Style = {}): ScenePrim => ({
    kind: 'path',
    d: d(tokens),
    fill,
    ...style,
  });
  const stroke = (tokens: readonly Token[], colour: string, sw: number, op = 1): ScenePrim =>
    path(tokens, 'none', { stroke: colour, sw, op: o(op) });
  const ellipse = (
    dx: number,
    dy: number,
    rx: number,
    ry: number,
    fill: string,
    style: Style = {}
  ): ScenePrim => ({ kind: 'ellipse', cx: X + m * dx, cy: Y + dy, rx, ry, fill, ...style });
  const rect = (
    dx: number,
    dy: number,
    w: number,
    h: number,
    r: number,
    fill: string,
    style: Style = {}
  ) =>
    path(
      [
        ...['M', dx + r, dy, 'L', dx + w - r, dy, 'Q', dx + w, dy, dx + w, dy + r],
        ...['L', dx + w, dy + h - r, 'Q', dx + w, dy + h, dx + w - r, dy + h],
        ...['L', dx + r, dy + h, 'Q', dx, dy + h, dx, dy + h - r],
        ...['L', dx, dy + r, 'Q', dx, dy, dx + r, dy, 'Z'],
      ],
      fill,
      style
    );

  // The ceramic white shell keeps its own shading; a coloured shell is a flat coat of its colour
  const ceramic = look.shell === 'white';
  const coat = ROBOT_SHELL_COLORS[look.shell];
  const outline = ceramic ? (off ? '#5c636d' : '#8b95a3') : shade(coat, off ? 0.45 : 0.6);
  const shell = ceramic ? (off ? '#aab1bb' : '#f4f6f9') : off ? shade(coat, 0.72) : coat;
  const joint = off ? '#6b7280' : '#9aa3af';
  const dark = '#1f2937';
  const accentBase = robotAccent(role, look);
  const accent = off ? shade(accentBase, 0.7) : accentBase;
  const accentLight = tint(accentBase, 0.55);
  const body = ceramic ? gradient(off ? 'bodyOff' : 'bodyOn') : shell;
  const headFill = ceramic ? gradient(off ? 'headOff' : 'headOn') : shell;
  const light = STATUS_LIGHT[status];
  const awake = !off && !ghost;
  const pose =
    status === 'working' || status === 'attention' || status === 'training'
      ? 'desk'
      : status === 'idle'
        ? 'cup'
        : 'rest';

  /** A limb: shoulder, elbow, hand */
  const limb = (points: readonly [number, number, number, number, number, number]) => {
    const [ax, ay, bx, by, cx, cy] = points;
    const line = ['M', ax, ay, 'L', bx, by, 'L', cx, cy];
    return [
      stroke(line, outline, 8.5),
      stroke(line, shell, 6),
      ellipse(bx, by, 2.2, 2.2, joint, { op: o() }),
      ellipse(cx, cy, 3.4, 3.4, '#3b424d', { op: o() }),
    ];
  };

  const prims: ScenePrim[] = [
    ellipse(0, 0, 21, 7.5, '#0b1220', {
      op: ghost ? 0.08 : night ? 0.4 : 0.25,
      filter: 'soft',
    }),
  ];

  // The hovering base and its light strip
  if (awake) prims.push(ellipse(0, -1, 17, 5.5, accent, { op: 0.4, filter: 'glow' }));
  prims.push(
    path(
      ['M', -15, -7, 'Q', -15, 1, 0, 1, 'Q', 15, 1, 15, -7, 'L', 12, -13, 'L', -12, -13, 'Z'],
      '#2b313a',
      { op: o() }
    ),
    stroke(['M', -14, -5, 'Q', 0, 2.2, 14, -5], accent, 1.8, off ? 0.6 : 1)
  );

  // The far ear and the far arm, behind the body
  prims.push(ellipse(-17, -69, 1.8, 4.5, joint, { op: o() }));
  prims.push(
    ...limb(pose === 'desk' ? [-13, -44, -19, -32, -27, -23] : [-13, -44, -18, -31, -18, -19])
  );

  // The body: shell, seam, chest panel with the role's emblem, power light, collar
  prims.push(
    path(
      [
        ...['M', -14, -14, 'Q', -18, -34, -11, -47, 'Q', -6, -52, 0, -52],
        ...['Q', 6, -52, 11, -47, 'Q', 18, -34, 14, -14],
        ...['Q', 7, -10, 0, -10, 'Q', -7, -10, -14, -14, 'Z'],
      ],
      body,
      { stroke: outline, op: o() }
    ),
    stroke(['M', -15, -22, 'Q', 0, -17, 15, -22], '#b6bfca', 1, 0.9),
    rect(-11, -43, 15, 13, 3.5, dark, { op: o() })
  );
  if (role === 'sales') {
    // A checklist
    prims.push(
      stroke(
        [
          'M',
          -8.5,
          -39,
          'L',
          -7,
          -37.5,
          'L',
          -4.5,
          -40.5,
          'M',
          -8.5,
          -34,
          'L',
          -7,
          -32.5,
          'L',
          -4.5,
          -35.5,
        ],
        '#ffffff',
        1.3
      ),
      stroke(['M', -2, -39, 'L', 2, -39, 'M', -2, -34, 'L', 2, -34], accentLight, 1.3)
    );
  } else if (role === 'marketer') {
    // A gauge
    prims.push(
      stroke(['M', -9, -33, 'Q', -9, -40.5, -3.5, -40.5, 'Q', 2, -40.5, 2, -33], '#ffffff', 1.3),
      stroke(['M', -3.5, -33.5, 'L', -0.5, -38.2], accentLight, 1.5),
      ellipse(-3.5, -33.5, 1.2, 1.2, '#ffffff', { op: o() })
    );
  } else if (role === 'engineer') {
    // Code brackets with a slash
    prims.push(
      stroke(
        [
          'M',
          -7,
          -39.6,
          'L',
          -9.6,
          -36.5,
          'L',
          -7,
          -33.4,
          'M',
          0,
          -39.6,
          'L',
          2.6,
          -36.5,
          'L',
          0,
          -33.4,
        ],
        '#ffffff',
        1.3
      ),
      stroke(['M', -2.4, -33, 'L', -4.6, -40], accentLight, 1.3)
    );
  } else {
    // A clock
    prims.push(
      ellipse(-3.5, -36.5, 4.7, 4.7, '#ffffff', { op: o() }),
      stroke(['M', -3.5, -36.5, 'L', -3.5, -39.9, 'M', -3.5, -36.5, 'L', -1.1, -35.3], dark, 1.1)
    );
  }
  prims.push(
    ellipse(8, -37, 2, 2, awake ? '#22c55e' : '#6b7280', { op: o() }),
    path(['M', -11, -49, 'Q', 0, -44, 11, -49, 'L', 11, -53, 'Q', 0, -48, -11, -53, 'Z'], accent, {
      op: o(),
    })
  );

  // The near arm, in front of the body
  prims.push(ellipse(14, -45, 4.6, 4.6, joint, { op: o() }));
  if (pose === 'desk') prims.push(...limb([15, -44, 19, -31, 8, -22]));
  else if (pose === 'cup') {
    prims.push(
      ...limb([15, -44, 20, -32, 11, -38]),
      rect(3.5, -47, 9, 9.5, 2, '#ffffff', { stroke: '#94a3b8' }),
      stroke(
        ['M', 6.5, -50, 'Q', 4, -54.5, 6.5, -58.5, 'M', 9.5, -50, 'Q', 7, -54.5, 9.5, -58.5],
        '#94a3b8',
        1,
        0.8
      )
    );
  } else prims.push(...limb([15, -44, 19, -31, 18, -19]));

  // The head: helmet, ear disc, visor and eyes, turned towards what the robot faces
  prims.push(
    look.head === 'dome'
      ? // A tall rounded crown over a flat chin
        path(
          [
            ...['M', -17, -59, 'L', -17, -70, 'Q', -17, -86, 0, -86, 'Q', 17, -86, 17, -70],
            ...['L', 17, -59, 'Q', 17, -55, 13, -55, 'L', -13, -55, 'Q', -17, -55, -17, -59, 'Z'],
          ],
          headFill,
          { stroke: outline, op: o() }
        )
      : rect(
          -17,
          -83,
          34,
          28,
          look.head === 'round' ? 14 : look.head === 'square' ? 4 : 12,
          headFill,
          { stroke: outline, op: o() }
        ),
    ellipse(17, -69, 3.6, 5.6, joint, { op: o() }),
    ellipse(17.5, -69, 1.9, 3.3, accent, { op: o() }),
    rect(-15, -77, 26, 15, 7, '#111827', { op: o() }),
    stroke(['M', -11, -74, 'Q', -4, -76, 4, -75], '#ffffff', 1, 0.3)
  );
  if (off) {
    prims.push(
      stroke(['M', -10.5, -69, 'L', -5.5, -69, 'M', -0.5, -69, 'L', 4.5, -69], '#6b7280', 1.6)
    );
  } else if (!ghost) {
    const eye = status === 'attention' ? '#fcd34d' : '#67e8f9';
    if (look.eyes === 'bar') {
      // One band of light across the visor; it bends into a smile while the robot waits
      const band =
        status === 'idle' ? ['M', -11, -68, 'Q', -3, -73.5, 5, -68] : ['M', -11, -69, 'L', 5, -69];
      prims.push(stroke(band, eye, 6.5, 0.35), stroke(band, eye, 2.6));
    } else {
      const wide = look.eyes === 'wide';
      prims.push(
        ellipse(-8, -69, wide ? 5.4 : 4.4, wide ? 5.6 : 4.8, eye, { op: 0.5, filter: 'glow' }),
        ellipse(2, -69, wide ? 5.4 : 4.4, wide ? 5.6 : 4.8, eye, { op: 0.5, filter: 'glow' })
      );
      if (status === 'idle') {
        // Relaxed, smiling eyes
        prims.push(
          stroke(
            ['M', -11, -68, 'Q', -8, -72.5, -5, -68, 'M', -1, -68, 'Q', 2, -72.5, 5, -68],
            eye,
            wide ? 2.4 : 1.8
          )
        );
      } else if (wide) {
        // Big round eyes with a spark in each
        prims.push(
          ellipse(-8, -69, 3.6, 3.9, eye),
          ellipse(2, -69, 3.6, 3.9, eye),
          ellipse(-9.2, -70.4, 1.1, 1.1, '#ffffff', { op: 0.9 }),
          ellipse(0.8, -70.4, 1.1, 1.1, '#ffffff', { op: 0.9 })
        );
      } else {
        prims.push(ellipse(-8, -69, 2.4, 3.1, eye), ellipse(2, -69, 2.4, 3.1, eye));
      }
      prims.push(
        status === 'attention'
          ? stroke(['M', -6, -64.5, 'L', 0, -64.5], eye, 1.1, 0.8)
          : stroke(['M', -6, -65.2, 'Q', -3, -63.6, 0, -65.2], eye, 1.1, 0.8)
      );
    }
  }

  // Highlights on the shell: the light comes from the upper left of the screen whichever way the
  // robot faces, so these are not mirrored (dx * m undoes the mirroring)
  if (!ghost) {
    prims.push(
      stroke(
        ['M', -13 * m, -40, 'Q', -15.5 * m, -30, -13 * m, -19],
        '#ffffff',
        1.6,
        off ? 0.25 : 0.7
      ),
      stroke(
        ['M', -11 * m, -79.5, 'Q', -4 * m, -82, 4 * m, -81],
        '#ffffff',
        1.6,
        off ? 0.25 : 0.75
      ),
      ellipse(-12.5 * m, -74, 1.4, 3, '#ffffff', { op: off ? 0.2 : 0.6 })
    );
  }

  // The antenna and its status beacon. Whatever the antenna, the beacon stays: it shows the status
  const top = look.head === 'dome' ? -86 : -83;
  const beaconY = look.antenna === 'none' ? top - 2 : top - 12;
  if (look.antenna !== 'none') prims.push(stroke(['M', 6, top, 'L', 6, top - 9], outline, 1.6));
  if (look.antenna === 'double') {
    prims.push(
      stroke(['M', -6, top, 'L', -6, top - 6], outline, 1.6),
      ellipse(-6, top - 8, 2.2, 2.2, accent, { op: o() })
    );
  }
  if (look.antenna === 'ring') {
    prims.push(ellipse(6, beaconY, 7.5, 3, 'none', { stroke: accent, sw: 1.6, op: o() }));
  }
  if (!ghost) {
    const pulse = status === 'working' || status === 'attention';
    const size = look.antenna === 'none' ? 0.75 : 1;
    prims.push(
      ellipse(6, beaconY, 7 * size, 7 * size, light, { op: 0.5, filter: 'glow', pulse }),
      ellipse(6, beaconY, 3.8 * size, 3.8 * size, light, { pulse })
    );
  }

  // The equipment: the role's, or the one the look chooses
  if (gear === 'headset') {
    // A headset: band, ear cup and a microphone in front of the mouth
    prims.push(
      stroke(['M', -14, -80, 'Q', 1, -93, 17, -76], dark, 2.6),
      ellipse(17, -69, 5, 6.5, dark, { op: o() }),
      ellipse(17.5, -69, 2, 3.1, accent, { op: o() }),
      stroke(['M', 15, -64, 'Q', 6, -58, -2, -62], dark, 1.6),
      ellipse(-2, -62, 2.3, 2.3, accent, { op: o() })
    );
  } else if (gear === 'scanner') {
    // A scanner bar on the head and a lens over the near eye
    prims.push(rect(-10, -88.5, 13, 6, 3, dark, { op: o() }));
    if (awake) prims.push(ellipse(-3.5, -85.5, 3.2, 3.2, accentLight, { op: 0.6, filter: 'glow' }));
    prims.push(
      ellipse(-3.5, -85.5, 1.8, 1.8, accentLight, { op: o() }),
      ellipse(2, -69, 5.4, 6, accent, { op: o(0.24) }),
      ellipse(2, -69, 5.4, 6, 'none', { stroke: accentLight, sw: 1.5, op: o() })
    );
  } else if (gear === 'goggles') {
    // Goggles pushed up on the forehead: a strap and two lenses
    prims.push(
      stroke(['M', -17, -79.5, 'Q', -2, -83.5, 16.5, -79.5], dark, 3),
      ellipse(-8.5, -82, 5.4, 4.2, dark, { op: o() }),
      ellipse(3, -82.6, 5.4, 4.2, dark, { op: o() }),
      ellipse(-8.5, -82, 3.4, 2.5, accentLight, { op: o(0.95) }),
      ellipse(3, -82.6, 3.4, 2.5, accentLight, { op: o(0.95) }),
      stroke(['M', -10, -83, 'L', -8, -83.6, 'M', 1.5, -83.6, 'L', 3.5, -84.2], '#ffffff', 1, 0.8)
    );
  } else if (gear === 'eyeshade') {
    // A bookkeeper's eyeshade: a band over the visor and a peak towards where the robot looks
    prims.push(
      path(
        ['M', -17, -77.5, 'Q', -2, -80.5, 15, -77.5, 'L', 15, -82, 'Q', -2, -85.5, -17, -82, 'Z'],
        accent,
        { op: o() }
      ),
      path(['M', -17, -79, 'L', -25, -76, 'Q', -20, -73.5, -14, -76, 'Z'], shade(accent, 0.8), {
        op: o(),
      })
    );
  } else if (gear === 'bow_tie') {
    // A bow tie under the collar
    prims.push(
      path(['M', -1, -47, 'L', -8, -51, 'L', -8, -43, 'Z'], accent, { stroke: dark, op: o() }),
      path(['M', -1, -47, 'L', 6, -51, 'L', 6, -43, 'Z'], accent, { stroke: dark, op: o() }),
      ellipse(-1, -47, 1.9, 1.9, dark, { op: o() })
    );
  }

  // What the status adds
  if (status === 'training') {
    // A graduation cap with its tassel
    prims.push(
      path(['M', -20, -85, 'L', 0, -92, 'L', 20, -85, 'L', 0, -78, 'Z'], '#111827'),
      stroke(['M', 14, -85, 'L', 15, -75], '#f59e0b', 1.4),
      ellipse(15, -74, 1.9, 1.9, '#f59e0b')
    );
  }
  if (status === 'attention') {
    prims.push(
      ellipse(25, -98, 11, 11, '#dc2626'),
      rect(23.5, -105, 3, 9, 1.5, '#ffffff'),
      ellipse(25, -92, 1.8, 1.8, '#ffffff')
    );
  }
  if (status === 'working') {
    // A "busy" bubble
    prims.push(rect(14, -112, 32, 18, 9, '#ffffff', { stroke: '#cbd5e1' }));
    for (const dx of [22, 30, 38])
      prims.push(ellipse(dx, -103, 2.2, 2.2, '#64748b', { pulse: true }));
  }
  if (status === 'paused') {
    // Charging
    prims.push(
      path(
        ['M', 27, -108, 'L', 19, -95, 'L', 26, -95, 'L', 23, -84, 'L', 33, -99, 'L', 26, -99, 'Z'],
        '#fbbf24'
      )
    );
  }
  return prims;
}
