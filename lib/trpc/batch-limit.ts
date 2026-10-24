/**
 * Calls one batched tRPC HTTP request may carry (#405). tRPC 11 batches without a limit by
 * default and its server has no option to cap a batch (only `allowBatching`), so one request
 * could run any number of procedures in parallel, paid AI calls among them, limited only by the
 * URL length. The clients split larger batches at this size (httpBatchLink `maxItems`) and the
 * handler (app/api/trpc/[trpc]/route.ts) refuses any batch above it.
 */
export const MAX_BATCH_CALLS = 20;
