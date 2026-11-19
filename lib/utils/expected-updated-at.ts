import { z } from 'zod';

/**
 * The `updatedAt` a client read, sent back with a save that replaces the whole row: the save only
 * goes through while the row still has it (the hearings, the diagnosis builder, the prep card).
 *
 * Bounded (#1240): the services move `updatedAt` on to the read value plus one millisecond, and a
 * date near the end of what JavaScript can hold has no next millisecond. Without the bound, such
 * a date made the save fail inside the service (a 500 that alerts whoever is on call) instead of
 * at the input check. No row is ever written with a date this far ahead.
 */
export const EXPECTED_UPDATED_AT_MAX = new Date('9999-12-31T00:00:00Z');

export const expectedUpdatedAtSchema = z.date().max(EXPECTED_UPDATED_AT_MAX);
