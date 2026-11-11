/**
 * Moved to lib/request-guard.ts (#471). This path stays as a re-export until its last importer
 * moves. No test mocks the guard: the route tests run the real one. A test that has to should mock
 * '@/lib/request-guard': that mock also reaches the files that still import this path, but a mock
 * of this path does not reach the files that import the new one.
 */
export * from '@/lib/request-guard';
