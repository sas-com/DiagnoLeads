import {
  createOrganizationContext,
  organizationInputSchema,
} from '@/lib/multi-tenant/middleware/organization';
import { TRPCError, initTRPC } from '@trpc/server';
import superjson from 'superjson';
import { ZodError } from 'zod';
import type { Context } from './context';
import { NUL_INPUT_MESSAGE, containsNul } from './reject-nul';

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
        // Only for invalid input: which field of the caller's own input is wrong. A validation
        // failing inside a procedure (database rows, other services) is an internal error.
        zodError:
          error.code === 'BAD_REQUEST' && error.cause instanceof ZodError
            ? error.cause.flatten()
            : null,
      },
    };
  },
});

/**
 * Export reusable router and procedure builders
 */
export const router = t.router;

/**
 * Every procedure refuses input containing NUL before it runs (#621): the database cannot store
 * it, and the failed write would surface as an internal error that alerts whoever is on call
 */
const baseProcedure = t.procedure.use(async ({ getRawInput, next }) => {
  if (containsNul(await getRawInput())) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: NUL_INPUT_MESSAGE });
  }
  return next();
});

export const publicProcedure = baseProcedure;

/**
 * Protected procedure - requires authentication
 */
export const protectedProcedure = baseProcedure.use(({ ctx, next }) => {
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
 * 4. Sets the current user for RLS, which is not in effect yet (see the NOTE in
 *    lib/multi-tenant/middleware/organization.ts): every query must still filter by organizationId
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
