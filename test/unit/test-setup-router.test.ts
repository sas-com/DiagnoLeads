/**
 * The default next/navigation mock in test/setup.ts keeps one router per file, like Next's
 * useRouter keeps one per page, and still starts each test with clean mocks (#636). Its search
 * params are one object as well, like Next's useSearchParams while the URL stays the same, and
 * cannot be changed, so no test leaves values in them for the next (#719).
 */
import { useRouter, useSearchParams } from 'next/navigation';
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

describe('default useSearchParams mock (test/setup.ts)', () => {
  it('returns the same empty search params on every call', () => {
    const searchParams = useSearchParams();

    expect(useSearchParams()).toBe(searchParams);
    expect(searchParams.toString()).toBe('');
  });

  it("cannot be changed, like Next's ReadonlyURLSearchParams", () => {
    // Next types the setters of ReadonlyURLSearchParams without arguments
    const searchParams = useSearchParams();

    expect(() => searchParams.set()).toThrow(/cannot be changed/);
    expect(() => searchParams.append()).toThrow(/cannot be changed/);
    expect(() => searchParams.delete()).toThrow(/cannot be changed/);
    expect(() => searchParams.sort()).toThrow(/cannot be changed/);
  });
});
