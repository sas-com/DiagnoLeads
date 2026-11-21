import { z } from 'zod';

/**
 * The `updatedAt` a client read, sent back with a save that replaces the whole row: the save only
 * goes through while the row still has it (the hearings, the diagnosis builder, the prep card).
 *
 * Bounded (#1240): the services move `updatedAt` on to the read value plus one millisecond, and a
 * date near the end of what JavaScript can hold has no next millisecond. Without the bound, such
 * a date made the save fail inside the service (a 500 that alerts whoever is on call) instead of
 * at the input check. No row is ever written with a date this far ahead, or this far back.
 */
export const EXPECTED_UPDATED_AT_MAX = new Date('9999-12-31T00:00:00Z');

/**
 * Bounded below as well: the value is also compared in SQL, and a date before year 1 (or year 0)
 * is written by toISOString in a form PostgreSQL cannot read, which fails the query the same way.
 * Every row is written by the app, long after 1970.
 */
export const EXPECTED_UPDATED_AT_MIN = new Date('1970-01-01T00:00:00Z');

export const expectedUpdatedAtSchema = z
  .date()
  .min(EXPECTED_UPDATED_AT_MIN)
  .max(EXPECTED_UPDATED_AT_MAX);
