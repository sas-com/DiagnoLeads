import { env } from '@/lib/env';
import { MAX_BATCH_CALLS } from '@/lib/trpc/batch-limit';
import type { AppRouter } from '@/server/routers/_app';
import { createTRPCClient, httpBatchLink } from '@trpc/client';
import superjson from 'superjson';

/**
 * Server-side tRPC client
 * Use this in Server Components and Server Actions
 */
export const serverClient = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: `${env.NEXT_PUBLIC_APP_URL}/api/trpc`,
      transformer: superjson,
      // The handler refuses larger batches (#405)
      maxItems: MAX_BATCH_CALLS,
    }),
  ],
});
