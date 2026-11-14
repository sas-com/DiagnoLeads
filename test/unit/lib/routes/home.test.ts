/** Home of the signed-in app: the AI office (#1153) */
import { safeCallbackPath } from '@/lib/auth/safe-callback';
import { isProtectedPage } from '@/lib/middleware/auth-redirect';
import { APP_LAUNCH_PARAM, APP_LAUNCH_VALUE } from '@/lib/routes/app-install';
import {
  ARRIVAL_PARAM,
  ARRIVAL_PATH,
  ARRIVAL_VALUE,
  HOME_ENTRY_PATH,
  HOME_PATH,
  HOME_VALUE,
  arrivalPath,
  homeEntryPath,
  homePath,
} from '@/lib/routes/home';
import { describe, expect, it } from 'vitest';

describe('home', () => {
  it('is the AI office, a page behind the sign-in', () => {
    expect(HOME_PATH).toBe('/office');
    expect(isProtectedPage(HOME_PATH)).toBe(true);
    expect(homePath('ja')).toBe('/ja/office');
    expect(homePath('en')).toBe('/en/office');
  });

  it('marks coming in with a value of its own, on the key of the start URL of the app', () => {
    expect(ARRIVAL_PARAM).toBe(APP_LAUNCH_PARAM);
    expect(ARRIVAL_VALUE).not.toBe(APP_LAUNCH_VALUE);
    expect(ARRIVAL_PATH).toBe('/office?source=login');
    expect(arrivalPath('ja')).toBe('/ja/office?source=login');
  });

  it('is where signing in leads when no page was asked for, or the one asked for is refused', () => {
    expect(safeCallbackPath(null)).toBe(ARRIVAL_PATH);
    expect(safeCallbackPath('https://evil.example/office')).toBe(ARRIVAL_PATH);
    // A page that was asked for is still gone back to
    expect(safeCallbackPath('/ja/leads?status=new')).toBe('/ja/leads?status=new');
    expect(safeCallbackPath('/ja/dashboard')).toBe('/ja/dashboard');
  });

  it('passes its own check: the fallback is a path safeCallbackPath would follow', () => {
    expect(safeCallbackPath(ARRIVAL_PATH, '/refused')).toBe(ARRIVAL_PATH);
    expect(safeCallbackPath(arrivalPath('ja'), '/refused')).toBe(arrivalPath('ja'));
  });

  it('marks coming home with another value on the same key: the logo is not signing in (#1169)', () => {
    expect(HOME_VALUE).not.toBe(ARRIVAL_VALUE);
    expect(HOME_VALUE).not.toBe(APP_LAUNCH_VALUE);
    expect(HOME_ENTRY_PATH).toBe(`${HOME_PATH}?${ARRIVAL_PARAM}=${HOME_VALUE}`);
    expect(homeEntryPath('ja')).toBe('/ja/office?source=home');
    expect(homeEntryPath('en')).toBe('/en/office?source=home');
  });

  it('comes home by a path that the sign-in would follow, for someone whose session ended', () => {
    // The proxy sends them to sign-in with the page they asked for; afterwards they are home
    expect(isProtectedPage(HOME_PATH)).toBe(true);
    expect(safeCallbackPath(homeEntryPath('ja'))).toBe('/ja/office?source=home');
  });
});
