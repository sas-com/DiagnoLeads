/**
 * Which floor the full-screen office shows (#1150): what it starts with, what the device
 * remembers, and the one verdict on a device that draws the 3D floor too slowly.
 */
import {
  DISPLAY_KEY,
  MEASURED_REPORTS,
  NEW_FPS_WATCH,
  SLOW_FPS,
  WARM_UP_REPORTS,
  firstDisplay,
  mayFallBack,
  readDisplay,
  watchFps,
  webglAvailable,
  writeDisplay,
} from '@/components/features/ai-employees/office-3d/office-display';
import { describe, expect, it } from 'vitest';

function memory(initial: Record<string, string> = {}) {
  const kept = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => kept.get(key) ?? null,
    setItem: (key: string, value: string) => void kept.set(key, value),
    kept,
  };
}
const refusing = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
};

/** Feeds reports to the watch and returns every verdict it gave */
function verdicts(reports: readonly number[], counts: (index: number) => boolean = () => true) {
  let watch = NEW_FPS_WATCH;
  const given: string[] = [];
  for (const [index, fps] of reports.entries()) {
    const result = watchFps(watch, fps, { counts: counts(index) });
    watch = result.watch;
    if (result.verdict) given.push(result.verdict);
  }
  return given;
}
const repeat = (fps: number, times: number) => Array.from({ length: times }, () => fps);

describe('readDisplay and writeDisplay', () => {
  it('keeps the display and why, and reads it back', () => {
    const storage = memory();
    writeDisplay(storage, { display: '3d', reason: 'chosen' });
    expect(readDisplay(storage)).toEqual({ display: '3d', reason: 'chosen' });
    writeDisplay(storage, { display: '2d', reason: 'slow' });
    expect(readDisplay(storage)).toEqual({ display: '2d', reason: 'slow' });
  });

  it('starts as if nothing was kept when the value is not one it wrote', () => {
    expect(readDisplay(memory())).toBeNull();
    for (const raw of ['', 'null', '"3d"', '{', '{"display":"4d","reason":"chosen"}', '{"display":"3d"}']) {
      expect(readDisplay(memory({ [DISPLAY_KEY]: raw }))).toBeNull();
    }
  });

  it('works without a storage, and with one that refuses', () => {
    expect(readDisplay(null)).toBeNull();
    expect(readDisplay(refusing)).toBeNull();
    expect(() => writeDisplay(null, { display: '3d', reason: 'chosen' })).not.toThrow();
    expect(() => writeDisplay(refusing, { display: '3d', reason: 'chosen' })).not.toThrow();
  });
});

describe('firstDisplay', () => {
  const able = { fits: true, webgl: true };

  it('starts with the default where the device remembers nothing', () => {
    expect(firstDisplay({ stored: null, ...able, preferred: '3d' })).toBe('3d');
    expect(firstDisplay({ stored: null, ...able, preferred: '2d' })).toBe('2d');
  });

  it('starts with what the person chose here, whatever the default', () => {
    expect(firstDisplay({ stored: { display: '2d', reason: 'chosen' }, ...able, preferred: '3d' })).toBe('2d');
    expect(firstDisplay({ stored: { display: '3d', reason: 'chosen' }, ...able, preferred: '2d' })).toBe('3d');
  });

  it('starts in 2D where 3D was too slow last time', () => {
    expect(firstDisplay({ stored: { display: '2d', reason: 'slow' }, ...able, preferred: '3d' })).toBe('2d');
  });

  it('never starts in 3D on a narrow screen or without WebGL', () => {
    const chosen = { display: '3d', reason: 'chosen' } as const;
    expect(firstDisplay({ stored: chosen, fits: false, webgl: true, preferred: '3d' })).toBe('2d');
    expect(firstDisplay({ stored: chosen, fits: true, webgl: false, preferred: '3d' })).toBe('2d');
  });
});

describe('mayFallBack', () => {
  it('takes 3D away from a slow device only where nobody chose it', () => {
    expect(mayFallBack(null, false)).toBe(true);
    expect(mayFallBack({ display: '2d', reason: 'slow' }, false)).toBe(true);
    // Chosen on an earlier visit, or during this one: not overruled
    expect(mayFallBack({ display: '3d', reason: 'chosen' }, false)).toBe(false);
    expect(mayFallBack(null, true)).toBe(false);
  });
});

describe('watchFps', () => {
  const whole = WARM_UP_REPORTS + MEASURED_REPORTS;

  it('says slow once, after the warm-up, when the average is under the threshold', () => {
    expect(verdicts(repeat(SLOW_FPS - 1, whole))).toEqual(['slow']);
    // Not before every measured report is in
    expect(verdicts(repeat(SLOW_FPS - 1, whole - 1))).toEqual([]);
  });

  it('says fine at the threshold and above, and on an average that recovers', () => {
    expect(verdicts(repeat(SLOW_FPS, whole))).toEqual(['fine']);
    expect(verdicts(repeat(60, whole))).toEqual(['fine']);
    // One bad second among good ones is not a slow device
    expect(verdicts([...repeat(60, WARM_UP_REPORTS), 5, ...repeat(60, MEASURED_REPORTS - 1)])).toEqual(['fine']);
  });

  it('does not count the warm-up: shaders and textures are being prepared', () => {
    expect(verdicts([...repeat(1, WARM_UP_REPORTS), ...repeat(60, MEASURED_REPORTS)])).toEqual(['fine']);
  });

  it('gives its verdict once and watches no further', () => {
    expect(verdicts([...repeat(60, whole), ...repeat(1, 30)])).toEqual(['fine']);
    expect(verdicts([...repeat(1, whole), ...repeat(1, 30)])).toEqual(['slow']);
  });

  it('skips the reports of a hidden page and of a floor that draws only on a change', () => {
    // Nothing counts: no verdict, however low the numbers
    expect(verdicts(repeat(0, 40), () => false)).toEqual([]);
    // The reports that do not count are left out, the others still decide
    const reports = [...repeat(60, WARM_UP_REPORTS), 0, 0, ...repeat(60, MEASURED_REPORTS)];
    const hidden = (index: number) => index !== WARM_UP_REPORTS && index !== WARM_UP_REPORTS + 1;
    expect(verdicts(reports, hidden)).toEqual(['fine']);
  });
});

describe('webglAvailable', () => {
  it('is false where the browser does not know WebGL, without asking a canvas (the unit tests)', () => {
    expect('WebGLRenderingContext' in globalThis).toBe(false);
    expect(webglAvailable()).toBe(false);
    expect(webglAvailable(undefined)).toBe(false);
  });

  it('asks a canvas for a context where the browser knows WebGL', () => {
    const view = (context: unknown) =>
      ({
        WebGLRenderingContext: function WebGLRenderingContext() {},
        document: { createElement: () => ({ getContext: () => context }) },
      }) as unknown as typeof globalThis;
    expect(webglAvailable(view({}))).toBe(true);
    // Switched off (a blocked GPU, a policy): the API is there, the context is not
    expect(webglAvailable(view(null))).toBe(false);
    const throwing = {
      WebGLRenderingContext: function WebGLRenderingContext() {},
      document: {
        createElement: () => ({
          getContext: () => {
            throw new Error('lost');
          },
        }),
      },
    } as unknown as typeof globalThis;
    expect(webglAvailable(throwing)).toBe(false);
  });
});
