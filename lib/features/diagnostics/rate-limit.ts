/**
 * Moved to lib/rate-limit.ts (#471). This path stays as a re-export until its last importer moves.
 * Tests mock '@/lib/rate-limit': that mock also reaches the files that still import this path, but
 * a mock of this path does not reach the files that import the new one.
 */
export * from '@/lib/rate-limit';
