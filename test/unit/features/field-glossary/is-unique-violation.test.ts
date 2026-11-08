/**
 * isUniqueViolation (Epic #780 P0b, Issue #800): it must detect a PostgreSQL unique-violation
 * (SQLSTATE 23505) even when drizzle wraps the driver error in a DrizzleQueryError and the SQLSTATE
 * sits on `.cause` — the shape the router's upsert relies on to map a duplicate to CONFLICT. This
 * is a pure unit test (no DB); the full path is exercised by the CI-only DB integration test.
 */
import { isUniqueViolation } from '@/lib/features/field-glossary/service';
import { describe, expect, it } from 'vitest';

describe('isUniqueViolation', () => {
  it('detects a bare postgres-js error carrying SQLSTATE 23505', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true);
  });

  it('detects a 23505 that drizzle wrapped in a DrizzleQueryError (the CI failure case)', () => {
    // drizzle throws `new Error("Failed query: …")` with the driver error on `.cause`.
    const cause = Object.assign(new Error('duplicate key value'), { code: '23505' });
    const wrapped = Object.assign(new Error('Failed query: insert into "field_glossary" …'), {
      cause,
    });
    expect(isUniqueViolation(wrapped)).toBe(true);
  });

  it('walks more than one level of cause', () => {
    expect(isUniqueViolation({ cause: { cause: { code: '23505' } } })).toBe(true);
  });

  it('is false for a different SQLSTATE, wrapped or not', () => {
    expect(isUniqueViolation({ code: '23502' })).toBe(false); // not-null violation
    expect(isUniqueViolation({ cause: { code: '23514' } })).toBe(false); // check violation
  });

  it('is false for non-errors and errors without a code', () => {
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
    expect(isUniqueViolation('23505')).toBe(false);
    expect(isUniqueViolation(new Error('boom'))).toBe(false);
    expect(isUniqueViolation({})).toBe(false);
  });

  it('terminates on a cyclic cause chain', () => {
    const cyclic: { code?: string; cause?: unknown } = {};
    cyclic.cause = cyclic;
    expect(isUniqueViolation(cyclic)).toBe(false);
  });
});
