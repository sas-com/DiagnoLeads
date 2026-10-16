import {
  createOrganizationContext,
  organizationInputSchema,
} from '@/lib/multi-tenant/middleware/organization';
import { TRPCError, initTRPC } from '@trpc/server';
import superjson from 'superjson';
import type { Context } from './context';

export const INTERNAL_ERROR_MESSAGE =
  'サーバーでエラーが発生しました。時間をおいてもう一度お試しください';

/**
 * Initialize tRPC with context
 */
const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    // Unexpected errors carry internal details (database messages, hosts): keep them in the
    // server logs and give the client a generic message in production
    const hideInternal =
      error.code === 'INTERNAL_SERVER_ERROR' && process.env.NODE_ENV === 'production';
    return {
      ...shape,
      message: hideInternal ? INTERNAL_ERROR_MESSAGE : shape.message,
      data: {
        ...shape.data,
        // Never send stack traces from production, whatever tRPC decided at start-up
        stack: process.env.NODE_ENV === 'production' ? undefined : shape.data.stack,
        zodError:
          error.cause instanceof Error && error.cause.name === 'ZodError' ? error.cause : null,
      },
    };
  },
});

/**
 * Export reusable router and procedure builders
 */
export const router = t.router;
export const publicProcedure = t.procedure;

/**
 * Protected procedure - requires authentication
 */
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session || !ctx.user) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }

  return next({
    ctx: {
      ...ctx,
      session: ctx.session,
      user: ctx.user,
    },
  });
});

/**
 * Organization procedure - requires authentication and organization membership
 *
 * This middleware:
 * 1. Validates organizationId in input
 * 2. Verifies user is a member of the organization
 * 3. Calculates CASL permissions based on role
 * 4. Sets current user for RLS (creates RLS-scoped database client)
 */
export const organizationProcedure = protectedProcedure
  .input(organizationInputSchema)
  .use(async ({ ctx, input, next }) => {
    const orgContext = await createOrganizationContext(ctx, input);

    return next({
      ctx: {
        ...ctx,
        ...orgContext,
      },
    });
  });
