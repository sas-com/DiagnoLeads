import { reportServerError } from '@/lib/ops/alert';
import { createContext } from '@/lib/trpc/context';
import { logDetails } from '@/lib/trpc/log-details';
import { appRouter } from '@/server/routers/_app';
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
    createContext,
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
