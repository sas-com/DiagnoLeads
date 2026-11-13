/** The robot built from a customized look (#1134) */
import {
  ROBOT_ACCENT_COLORS,
  ROBOT_SHELL_COLORS,
  ROLE_ACCENTS,
  ROLE_GEARS,
  robotAccent,
  robotPrims,
} from '@/components/features/ai-employees/office-robot';
import { STATUS_LIGHT } from '@/components/features/ai-employees/office-prims';
import {
  TALK_LINES,
  looksByRole,
  talkLineKey,
} from '@/components/features/ai-employees/office-president';
import {
  AI_TONES,
  DEFAULT_ROBOT_LOOK,
  ROBOT_ANTENNAS,
  ROBOT_LOOK_PARTS,
  ROBOT_LOOK_PART_NAMES,
  type RobotLook,
} from '@/lib/features/ai-employees/types/profile';
import { AI_EMPLOYEE_ROLES, type AiEmployeeRole } from '@/lib/features/ai-employees/types/roles';
import { MESSAGE_FILES, mergeMessageFiles } from '@/lib/i18n/messages';
import { describe, expect, it } from 'vitest';

const draw = (role: AiEmployeeRole, look?: RobotLook, status = 'idle') =>
  robotPrims({
    role,
    status: status as never,
    x: 0,
    y: 0,
    facing: 'left',
    night: false,
    gradient: (name) => `url(#${name})`,
    look,
  });
const fills = (role: AiEmployeeRole, look?: RobotLook, status?: string) =>
  JSON.stringify(draw(role, look, status));

describe('robotPrims with a look', () => {
  it('is the role’s own build without a look, and with the default look', () => {
    for (const role of AI_EMPLOYEE_ROLES) {
      expect(draw(role, DEFAULT_ROBOT_LOOK)).toEqual(draw(role));
    }
  });

  it('changes the drawing with every option of every part', () => {
    for (const part of ROBOT_LOOK_PART_NAMES) {
      const seen = new Set<string>();
      for (const option of ROBOT_LOOK_PARTS[part]) {
        // 'role' is the same as the role's own option: compare on a role whose own differs
        seen.add(fills('sales', { ...DEFAULT_ROBOT_LOOK, [part]: option } as RobotLook));
      }
      // gear: 'role' equals 'headset' for sales; accent: 'role' equals 'teal' for sales
      const same = part === 'gear' || part === 'accent' ? 1 : 0;
      expect(seen.size).toBe(ROBOT_LOOK_PARTS[part].length - same);
    }
  });

  it('wears the gear of its role unless the look chooses another', () => {
    for (const role of AI_EMPLOYEE_ROLES) {
      expect(draw(role, { ...DEFAULT_ROBOT_LOOK, gear: ROLE_GEARS[role] })).toEqual(draw(role));
    }
    expect(fills('sales', { ...DEFAULT_ROBOT_LOOK, gear: 'none' })).not.toBe(fills('sales'));
  });

  it('uses the accent and the shell colours of the look', () => {
    expect(robotAccent('sales')).toBe(ROLE_ACCENTS.sales);
    expect(robotAccent('sales', { ...DEFAULT_ROBOT_LOOK, accent: 'pink' })).toBe(
      ROBOT_ACCENT_COLORS.pink
    );
    const pink = fills('sales', { ...DEFAULT_ROBOT_LOOK, accent: 'pink' });
    expect(pink).toContain(ROBOT_ACCENT_COLORS.pink);
    expect(pink).not.toContain(ROLE_ACCENTS.sales);
    const mint = fills('sales', { ...DEFAULT_ROBOT_LOOK, shell: 'mint' });
    expect(mint).toContain(ROBOT_SHELL_COLORS.mint);
    // The ceramic white keeps its own shading
    expect(fills('sales')).toContain('url(#bodyOn)');
    expect(mint).not.toContain('url(#bodyOn)');
  });

  it('keeps the status beacon whatever the antenna, also without one', () => {
    for (const antenna of ROBOT_ANTENNAS) {
      for (const status of ['working', 'attention', 'training', 'paused'] as const) {
        expect(fills('engineer', { ...DEFAULT_ROBOT_LOOK, antenna }, status)).toContain(
          STATUS_LIGHT[status]
        );
      }
    }
  });

  it('draws a vacant seat as a faint outline whatever the look', () => {
    const ghost = draw('sales', { ...DEFAULT_ROBOT_LOOK, shell: 'graphite' }, 'vacant');
    expect(ghost.every((prim) => (prim.op ?? 1) <= 0.3)).toBe(true);
  });
});

describe('looksByRole', () => {
  it('maps each hired role to its look, and leaves the others out', () => {
    const look = { ...DEFAULT_ROBOT_LOOK, head: 'dome' } as RobotLook;
    expect(looksByRole([{ role: 'sales', profile: { look } }])).toEqual({ sales: look });
  });
});

describe('talkLineKey', () => {
  it('keeps the polite lines where they always were', () => {
    expect(talkLineKey('idle', 'polite')).toBe('talk.lines.idle');
    expect(talkLineKey('pausedDone', 'polite')).toBe('talk.paused');
    expect(talkLineKey('failed', 'polite')).toBe('talk.failed');
  });

  it('has every line of every tone in both languages, with the same placeholders', () => {
    const lookup = (messages: Record<string, unknown>, key: string) =>
      key
        .split('.')
        .reduce<unknown>(
          (node, part) => (node as Record<string, unknown> | undefined)?.[part],
          (messages.aiOffice as Record<string, unknown>).immersive
        );
    const placeholders = (text: string) => (text.match(/\{[a-z]+\}/g) ?? []).sort().join();
    for (const locale of ['ja', 'en'] as const) {
      const messages = mergeMessageFiles(MESSAGE_FILES[locale]) as Record<string, unknown>;
      for (const line of TALK_LINES) {
        const polite = lookup(messages, talkLineKey(line, 'polite'));
        expect(typeof polite, `${locale} polite ${line}`).toBe('string');
        for (const tone of AI_TONES) {
          const text = lookup(messages, talkLineKey(line, tone));
          expect(typeof text, `${locale} ${tone} ${line}`).toBe('string');
          // A tone may leave a value unsaid (the vacant seat's {role} is never used here), but
          // never asks for one the polite line does not get
          for (const name of placeholders(text as string).split(',').filter(Boolean)) {
            expect(placeholders(polite as string), `${locale} ${tone} ${line}`).toContain(name);
          }
        }
      }
    }
  });
});
