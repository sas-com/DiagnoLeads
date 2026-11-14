import {
  OFFICE_MIN_WIDTH,
  isAppWindow,
  launchedAsApp,
  officeFits,
} from '@/components/features/ai-employees/office-app';
import { describe, expect, it } from 'vitest';

/** The office as an installed app (#1125) */
describe('launchedAsApp', () => {
  it('is true for the start URL of the manifest', () => {
    expect(launchedAsApp('?source=app', false)).toBe(true);
    expect(launchedAsApp('?tab=1&source=app', false)).toBe(true);
  });

  it('is true in a window of the installed app, whatever the URL', () => {
    expect(launchedAsApp('', true)).toBe(true);
  });

  it('is false for the office opened in a browser tab', () => {
    expect(launchedAsApp('', false)).toBe(false);
    expect(launchedAsApp('?source=email', false)).toBe(false);
    expect(launchedAsApp('?app=1', false)).toBe(false);
  });
});

describe('officeFits', () => {
  it('takes a tablet and wider, and not a phone (#1139)', () => {
    expect(OFFICE_MIN_WIDTH).toBe(768);
    expect(officeFits(390)).toBe(false);
    expect(officeFits(767)).toBe(false);
    expect(officeFits(768)).toBe(true);
    expect(officeFits(1440)).toBe(true);
  });
});

describe('isAppWindow', () => {
  const win = (matches: boolean, standalone?: boolean) =>
    ({
      navigator: { standalone },
      matchMedia: () => ({ matches }),
    }) as unknown as Window;

  it('reads the display mode of the window', () => {
    expect(isAppWindow(win(true))).toBe(true);
    expect(isAppWindow(win(false))).toBe(false);
  });

  it('reads what iOS reports on the navigator', () => {
    expect(isAppWindow(win(false, true))).toBe(true);
  });

  it('is false where the display mode cannot be asked', () => {
    expect(isAppWindow({ navigator: {} } as unknown as Window)).toBe(false);
  });
});
