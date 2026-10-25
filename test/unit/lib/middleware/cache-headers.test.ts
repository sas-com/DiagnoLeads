import { getCacheHeaders } from '@/lib/middleware/cache-headers';
import { describe, expect, it } from 'vitest';

describe('cache headers', () => {
  it('leaves files to Next.js, so that a missing one is not kept for a year (#68)', () => {
    // The app's icon (Next.js caches it itself) and a path that is not found
    expect(getCacheHeaders('/icon.svg')).toEqual({});
    expect(getCacheHeaders('/x/y.png')).toEqual({});
    expect(getCacheHeaders('/main.js')).toEqual({});
  });

  it('never keeps a page of a language for long, even when it ends like a file', () => {
    expect(getCacheHeaders('/ja/leads/x/hearings/y.png')['Cache-Control']).toBe('public, max-age=0, must-revalidate');
    expect(getCacheHeaders('/EN/leads/a.js')['Cache-Control']).toBe('public, max-age=0, must-revalidate');
  });

  it('does not cache the API, even when a path ends like a file', () => {
    expect(getCacheHeaders('/api/trpc/leads.list')['Cache-Control']).toContain('no-store');
    expect(getCacheHeaders('/api/media/file/a.png')['Cache-Control']).toContain('no-store');
  });

  it('never keeps the QR entry, so pausing a campaign takes effect on the next scan (#503)', () => {
    expect(getCacheHeaders('/q/AbCd2345')).toEqual({ 'Cache-Control': 'no-store' });
  });
});
