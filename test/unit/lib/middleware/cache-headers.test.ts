import { getCacheHeaders } from '@/lib/middleware/cache-headers';
import { describe, expect, it } from 'vitest';

describe('cache headers', () => {
  it('keeps static files for a year', () => {
    expect(getCacheHeaders('/_next/static/chunks/app.js')['Cache-Control']).toContain('immutable');
    expect(getCacheHeaders('/images/logo.png')['Cache-Control']).toContain('immutable');
  });

  it('never keeps a page of a language for long, even when it ends like a file', () => {
    expect(getCacheHeaders('/ja/leads/x/hearings/y.png')['Cache-Control']).toBe('public, max-age=0, must-revalidate');
    expect(getCacheHeaders('/EN/leads/a.js')['Cache-Control']).toBe('public, max-age=0, must-revalidate');
  });

  it('does not cache the API', () => {
    expect(getCacheHeaders('/api/trpc/leads.list')['Cache-Control']).toContain('no-store');
  });
});
