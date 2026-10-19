import { expect, test } from '@playwright/test';

/**
 * E2E Test: a signed-out visitor of an admin page is sent to sign-in by the middleware
 * (lib/middleware/auth-redirect.ts), including the spellings that once slipped through (#166,
 * #167). The logic has unit tests; this checks the middleware (proxy) really calls it, against
 * the production build in CI (#247).
 */
test.describe('Sign-in redirect for signed-out visitors', () => {
  const direct = [
    { path: '/ja/dashboard', login: '/ja/login' },
    { path: '/en/leads', login: '/en/login' },
    // Percent-encoded language and page: the router serves /ja/dashboard
    { path: '/%6Aa/dash%62oard', login: '/ja/login' },
    // A page id ending in .png must not pass as a static file
    { path: '/ja/leads/abc.png', login: '/ja/login' },
  ];

  for (const { path, login } of direct) {
    test(`${path} goes to ${login} @smoke`, async ({ request }) => {
      const response = await request.get(path, { maxRedirects: 0 });
      expect([307, 308]).toContain(response.status());
      const location = new URL(response.headers().location ?? '', 'http://localhost');
      expect(location.pathname).toBe(login);
      expect(location.searchParams.get('callbackUrl')).toBe(path);
    });
  }

  // Upper case or no language: first moved to /ja/dashboard, which then goes to sign-in. Checked
  // hop by hop: in a browser the admin layout would also end at sign-in on its own
  for (const path of ['/JA/dashboard', '/dashboard']) {
    test(`${path} goes to sign-in through /ja/dashboard @smoke`, async ({ request }) => {
      const first = await request.get(path, { maxRedirects: 0 });
      expect([307, 308]).toContain(first.status());
      const next = new URL(first.headers().location ?? '', 'http://localhost');
      expect(next.pathname).toBe('/ja/dashboard');

      const second = await request.get(next.pathname, { maxRedirects: 0 });
      expect([307, 308]).toContain(second.status());
      expect(new URL(second.headers().location ?? '', 'http://localhost').pathname).toBe(
        '/ja/login'
      );
    });
  }

  for (const path of ['/ja/ax-migration', '/ja/ax-diagnosis', '/ja/login']) {
    test(`${path} stays public @smoke`, async ({ request }) => {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.status()).toBe(200);
    });
  }
});
