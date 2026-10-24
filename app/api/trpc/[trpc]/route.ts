import { reportServerError } from '@/lib/ops/alert';
import { MAX_BATCH_CALLS } from '@/lib/trpc/batch-limit';
import { createContext } from '@/lib/trpc/context';
import { logDetails } from '@/lib/trpc/log-details';
import { appRouter } from '@/server/routers/_app';
import { TRPCError } from '@trpc/server';
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { after } from 'next/server';

/**
 * tRPC API Route Handler
 * Handles all tRPC requests at /api/trpc/*
 */
const handler = (req: Request) =>
  fetchRequestHandler({
    endpoint: '/api/trpc',
    req,
    router: appRouter,
    createContext: (opts) => {
      // tRPC has no server option for the size of a batch: refuse large ones before the
      // session is read, so every call of the batch fails and none of them runs (#405)
      if (opts.info.calls.length > MAX_BATCH_CALLS) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `A batch may carry at most ${MAX_BATCH_CALLS} calls`,
        });
      }
      return createContext(opts);
    },
    // Clients get a generic message for unexpected errors (lib/trpc/init.ts), so the details
    // are kept here in the server logs
    onError: ({ path, error }) => {
      if (process.env.NODE_ENV === 'development' || error.code === 'INTERNAL_SERVER_ERROR') {
        console.error(
          `tRPC failed on ${path ?? '<no-path>'}:`,
          error.message,
          logDetails(error.cause ?? error)
        );
      }
      // Unexpected failures in production also reach the people on call (#227)
      if (error.code === 'INTERNAL_SERVER_ERROR' && process.env.NODE_ENV === 'production') {
        after(() => reportServerError(`trpc/${path ?? 'unknown'}`, error.cause ?? error));
      }
    },
  });

export { handler as GET, handler as POST };
