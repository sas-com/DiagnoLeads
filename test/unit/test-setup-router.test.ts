/**
 * The default next/navigation mock in test/setup.ts keeps one router per file, like Next's
 * useRouter keeps one per page, and still starts each test with clean mocks (#636).
 */
import { useRouter } from 'next/navigation';
import { describe, expect, it, onTestFinished, vi } from 'vitest';

describe('default useRouter mock (test/setup.ts)', () => {
  it('returns the same router and the same functions on every call', () => {
    const router = useRouter();

    router.push('/ja/leads');

    expect(useRouter()).toBe(router);
    expect(useRouter().push).toBe(router.push);
    expect(useRouter().push).toHaveBeenCalledWith('/ja/leads');
  });

  it('drops the calls and implementations a test left once the test ends', () => {
    const router = useRouter();
    router.push('/ja/leads');
    vi.mocked(router.back).mockImplementation(() => {
      throw new Error('left over from this test');
    });

    // Vitest runs onTestFinished after the afterEach hooks, so this checks the router as the
    // next test gets it, whatever order the tests run in
    onTestFinished(() => {
      expect(router.push).not.toHaveBeenCalled();
      expect(() => router.back()).not.toThrow();
    });
  });
});
