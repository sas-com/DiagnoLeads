import {
  OFFICE_MIN_WIDTH,
  isAppWindow,
  cameHome,
  justArrived,
  launchedAsApp,
  officeFits,
  withoutArrival,
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

describe('justArrived', () => {
  it('is true for someone who just signed in or joined, and for nobody else', () => {
    expect(justArrived('?source=login')).toBe(true);
    expect(justArrived('?tab=1&source=login')).toBe(true);
    expect(justArrived('')).toBe(false);
    expect(justArrived('?source=app')).toBe(false);
    expect(justArrived('?login=1')).toBe(false);
  });
});

describe('cameHome (#1169)', () => {
  it('is true for someone who came by the logo, and not for someone who signed in', () => {
    expect(cameHome('?source=home')).toBe(true);
    expect(cameHome('?tab=1&source=home')).toBe(true);
    expect(cameHome('?source=login')).toBe(false);
    expect(cameHome('?source=app')).toBe(false);
    expect(cameHome('')).toBe(false);
    expect(justArrived('?source=home')).toBe(false);
  });
});

describe('withoutArrival', () => {
  it('drops the mark once it was read, and keeps the rest of the address', () => {
    expect(withoutArrival('/ja/office', '?source=login')).toBe('/ja/office');
    expect(withoutArrival('/ja/office', '?tab=1&source=login', '#staff')).toBe(
      '/ja/office?tab=1#staff'
    );
  });

  it('drops the mark of coming home too', () => {
    expect(withoutArrival('/ja/office', '?source=home')).toBe('/ja/office');
    expect(withoutArrival('/ja/office', '?source=home&tab=1', '#staff')).toBe(
      '/ja/office?tab=1#staff'
    );
  });

  it('leaves an address alone that carries no such mark: the start URL of the app stays', () => {
    expect(withoutArrival('/ja/office', '')).toBeNull();
    expect(withoutArrival('/ja/office', '?source=app')).toBeNull();
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
