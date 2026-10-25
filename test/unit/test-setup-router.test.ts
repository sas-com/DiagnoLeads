/**
 * The default next/navigation mock in test/setup.ts keeps one router per file, like Next's
 * useRouter keeps one per page, and still starts each test with clean mocks (#636).
 */
import { useRouter } from 'next/navigation';
import { describe, expect, it, vi } from 'vitest';

describe('default useRouter mock (test/setup.ts)', () => {
  it('returns the same router and the same functions on every call', () => {
    const router = useRouter();
    vi.mocked(router.back).mockImplementation(() => {
      throw new Error('left over from the previous test');
    });

    router.push('/ja/leads');

    expect(useRouter()).toBe(router);
    expect(useRouter().push).toBe(router.push);
    expect(useRouter().push).toHaveBeenCalledWith('/ja/leads');
  });

  // Runs after the test above, which left a call and an implementation on the shared router
  it('drops the calls and implementations of the previous test', () => {
    const router = useRouter();

    expect(router.push).not.toHaveBeenCalled();
    expect(() => router.back()).not.toThrow();
  });
});
