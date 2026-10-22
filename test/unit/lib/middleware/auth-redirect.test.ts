import { isProtectedPage, signInRedirect } from '@/lib/middleware/auth-redirect';
import { ADMIN_PAGE_PREFIXES } from '@/lib/routes/admin-pages';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const request = (path: string, cookie?: string) =>
  new Request(`https://app.example${path}`, cookie ? { headers: { cookie } } : undefined);

describe('sign-in redirect for admin pages', () => {
  it('knows the admin pages, and nothing public', () => {
    for (const path of ['/dashboard', '/leads', '/leads/abc', '/settings/members', '/analytics', '/organizations/new', '/content/blog']) {
      expect(isProtectedPage(path)).toBe(true);
    }
    for (const path of ['/', '/login', '/signup', '/invite/tok', '/ax-diagnosis', '/ax-migration', '/dashboards', '/leadsx', '/api/trpc/leads.list']) {
      expect(isProtectedPage(path)).toBe(false);
    }
  });

  it('covers every page folder of the admin app', () => {
    const folders = readdirSync(join(process.cwd(), 'app/[locale]/(dashboard)'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `/${entry.name}`);
    expect([...ADMIN_PAGE_PREFIXES].sort()).toEqual(folders.sort());
  });

  it('is not fooled by percent-encoded or upper-case paths', () => {
    for (const path of ['/ja/dash%62oard', '/ja/%64ashboard', '/ja/leads%2Fabc', '/ja/Settings/members', '/%6Aa/dashboard', '/j%61/leads', '/JA/dashboard']) {
      expect(signInRedirect(request(path)), path).not.toBeNull();
    }
    expect(signInRedirect(request('/ja/dashboard/%E0'))).not.toBeNull(); // malformed escape
    expect(signInRedirect(request('/ja/%E0%A4%A'))).toBeNull();
  });

  it('sends a signed-out visitor to sign-in in the same language, coming back afterwards', () => {
    const url = signInRedirect(request('/en/leads?leadId=1'));
    expect(url?.pathname).toBe('/en/login');
    expect(url?.searchParams.get('callbackUrl')).toBe('/en/leads?leadId=1');
    expect(signInRedirect(request('/%6Aa/dashboard'))?.pathname).toBe('/ja/login');
  });

  it('uses the default language when the path has none', () => {
    expect(signInRedirect(request('/dashboard'))?.pathname).toBe('/ja/login');
  });

  it('lets a visitor with a session cookie through, plain or secure; the page checks it is valid', () => {
    expect(signInRedirect(request('/ja/dashboard', 'better-auth.session_token=abc'))).toBeNull();
    expect(signInRedirect(request('/ja/dashboard', '__Secure-better-auth.session_token=abc'))).toBeNull();
  });

  it('leaves public pages alone', () => {
    expect(signInRedirect(request('/ja/ax-diagnosis'))).toBeNull();
    expect(signInRedirect(request('/ja/invite/tok'))).toBeNull();
    expect(signInRedirect(request('/ja/email/unsubscribe'))).toBeNull();
    expect(signInRedirect(request('/en/email/unsubscribe'))).toBeNull();
    expect(signInRedirect(request('/ja'))).toBeNull();
  });
});
