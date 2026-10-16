import { isProtectedPage, signInRedirect } from '@/lib/middleware/auth-redirect';
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

  it('is not fooled by percent-encoded or upper-case paths', () => {
    for (const path of ['/dash%62oard', '/%64ashboard', '/leads%2Fabc', '/Settings/members']) {
      expect(isProtectedPage(path)).toBe(true);
    }
    expect(isProtectedPage('/%E0%A4%A')).toBe(false); // malformed escape
  });

  it('sends a signed-out visitor to sign-in in the same language, coming back afterwards', () => {
    const url = signInRedirect(request('/en/leads?leadId=1'), '/en/leads', '/leads', '?leadId=1');
    expect(url?.pathname).toBe('/en/login');
    expect(url?.searchParams.get('callbackUrl')).toBe('/en/leads?leadId=1');
  });

  it('uses Japanese when the path has no language', () => {
    expect(signInRedirect(request('/dashboard'), '/dashboard', '/dashboard')?.pathname).toBe('/ja/login');
  });

  it('lets a visitor with a session cookie through, plain or secure', () => {
    expect(signInRedirect(request('/ja/dashboard', 'better-auth.session_token=abc'), '/ja/dashboard', '/dashboard')).toBeNull();
    expect(
      signInRedirect(request('/ja/dashboard', '__Secure-better-auth.session_token=abc'), '/ja/dashboard', '/dashboard')
    ).toBeNull();
  });

  it('leaves public pages alone', () => {
    expect(signInRedirect(request('/ja/ax-diagnosis'), '/ja/ax-diagnosis', '/ax-diagnosis')).toBeNull();
    expect(signInRedirect(request('/ja/invite/tok'), '/ja/invite/tok', '/invite/tok')).toBeNull();
  });
});
