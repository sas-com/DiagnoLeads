/**
 * test/mocks/next-navigation: search params for next/navigation mocks keep one object while the
 * URL stays the same and cannot be changed, like Next's useSearchParams (#719)
 */
import { ReadonlySearchParams, searchParamsCache } from '@/test/mocks/next-navigation';
import { describe, expect, it } from 'vitest';

describe('searchParamsCache', () => {
  it('returns the same object while the URL string stays the same', () => {
    const searchParamsFor = searchParamsCache();

    const first = searchParamsFor('status=new&page=2');

    expect(searchParamsFor('status=new&page=2')).toBe(first);
    expect(first.get('status')).toBe('new');
    expect(first.get('page')).toBe('2');
  });

  it('builds a new object only when the URL string changes', () => {
    const searchParamsFor = searchParamsCache();
    const empty = searchParamsFor('');

    const next = searchParamsFor('page=3');

    expect(next).not.toBe(empty);
    expect(next.get('page')).toBe('3');
    expect(searchParamsFor('page=3')).toBe(next);
    expect(empty.toString()).toBe('');
  });

  it('keeps a separate object for each cache', () => {
    expect(searchParamsCache()('page=2')).not.toBe(searchParamsCache()('page=2'));
  });
});

describe('ReadonlySearchParams', () => {
  it('reads like URLSearchParams', () => {
    const searchParams = new ReadonlySearchParams('owner=mine&kind=migration');

    expect(searchParams.get('owner')).toBe('mine');
    expect(new URLSearchParams(searchParams).toString()).toBe('owner=mine&kind=migration');
  });

  it('throws on every setter, so the shared object stays as it was', () => {
    const searchParams = new ReadonlySearchParams('page=2');

    expect(() => searchParams.set()).toThrow(/cannot be changed/);
    expect(() => searchParams.append()).toThrow(/cannot be changed/);
    expect(() => searchParams.delete()).toThrow(/cannot be changed/);
    expect(() => searchParams.sort()).toThrow(/cannot be changed/);
    expect(searchParams.toString()).toBe('page=2');
  });
});
