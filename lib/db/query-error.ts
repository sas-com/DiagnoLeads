import { DrizzleQueryError } from 'drizzle-orm';

/**
 * Since drizzle-orm 0.44, a failed query throws DrizzleQueryError around the driver's error,
 * which carries the database code, table and constraint. Logs and alerts read those from the
 * driver's error, so unwrap it here (#236)
 */
export function unwrapQueryError(error: unknown): unknown {
  return error instanceof DrizzleQueryError && error.cause !== undefined ? error.cause : error;
}
