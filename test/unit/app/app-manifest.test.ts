import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  APP_INSTALL_METADATA,
  APP_LAUNCH_PARAM,
  APP_LAUNCH_VALUE,
  APP_MANIFEST_PATH,
} from '@/lib/routes/app-install';
import { shouldSkipI18nMiddleware } from '@/lib/i18n/middleware';
import { isProtectedPage } from '@/lib/middleware/auth-redirect';
import { describe, expect, it, vi } from 'vitest';

// next-intl's middleware does not load in the test environment; only the path rules are read
vi.mock('next-intl/middleware', () => ({ default: vi.fn(() => vi.fn()) }));

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose: string;
}

const root = resolve(__dirname, '../../..');
const manifest = JSON.parse(readFileSync(resolve(root, `public${APP_MANIFEST_PATH}`), 'utf8')) as {
  name: string;
  short_name: string;
  start_url: string;
  scope: string;
  display: string;
  display_override: string[];
  icons: ManifestIcon[];
};

/** Width and height of a PNG, from its IHDR chunk */
function pngSize(path: string): string {
  const data = readFileSync(path);
  expect(data.subarray(1, 4).toString('latin1')).toBe('PNG');
  return `${data.readUInt32BE(16)}x${data.readUInt32BE(20)}`;
}

/** The installable app (#1125) */
describe('the web app manifest', () => {
  it('opens full screen, and without the browser around it where that is not supported', () => {
    expect(manifest.display).toBe('fullscreen');
    expect(manifest.display_override).toEqual(['fullscreen', 'standalone']);
    expect(manifest.name).toContain('DiagnoLeads');
    expect(manifest.short_name.length).toBeLessThanOrEqual(12);
  });

  it('starts in the AI office, on a page behind the sign-in, and tells the office so', () => {
    const start = new URL(manifest.start_url, 'https://example.com');
    expect(start.pathname).toBe('/office');
    expect(start.searchParams.get(APP_LAUNCH_PARAM)).toBe(APP_LAUNCH_VALUE);
    expect(isProtectedPage(start.pathname)).toBe(true);
    expect(manifest.scope).toBe('/');
    // No language in the URL: the language redirect picks the user's own
    expect(shouldSkipI18nMiddleware(start.pathname)).toBe(false);
  });

  it('has the icons it names, in the sizes it names', () => {
    const sizes = manifest.icons.map((icon) => `${icon.purpose} ${icon.sizes}`);
    expect(sizes).toEqual(expect.arrayContaining(['any 192x192', 'any 512x512', 'maskable 512x512']));
    for (const icon of manifest.icons) {
      expect(icon.type).toBe('image/png');
      expect(pngSize(resolve(root, `public${icon.src}`))).toBe(icon.sizes);
    }
    expect(pngSize(resolve(root, 'app/apple-icon.png'))).toBe('180x180');
  });

  it('is served as a file: the language redirect leaves its path alone', () => {
    expect(shouldSkipI18nMiddleware(APP_MANIFEST_PATH)).toBe(true);
    expect(APP_INSTALL_METADATA.manifest).toBe(APP_MANIFEST_PATH);
  });

  it('is linked from the admin and the sign-in layouts only', () => {
    const layout = (path: string) => readFileSync(resolve(root, path), 'utf8');
    expect(layout('app/[locale]/(dashboard)/layout.tsx')).toContain('APP_INSTALL_METADATA');
    expect(layout('app/[locale]/(auth)/layout.tsx')).toContain('APP_INSTALL_METADATA');
    expect(layout('app/layout.tsx')).not.toContain('manifest');
    expect(layout('app/[locale]/layout.tsx')).not.toContain('manifest');
  });
});
