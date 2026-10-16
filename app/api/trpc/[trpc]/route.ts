import { createContext } from '@/lib/trpc/context';
import { appRouter } from '@/server/routers/_app';
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';

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
        console.error(`tRPC failed on ${path ?? '<no-path>'}:`, error.message);
      }
    },
  });

export { handler as GET, handler as POST };
