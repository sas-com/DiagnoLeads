import { env } from '@/lib/env';
import { protectedProcedure } from '@/lib/trpc/init';
import { TRPCError } from '@trpc/server';

/**
 * Who may edit FAQs and blog posts: the users listed in CONTENT_EDITOR_EMAILS (comma-separated,
 * case-insensitive). Unset or empty means nobody, so a missing setting never opens editing to
 * every signed-up user (#87).
 */
export function isContentEditor(email: string | null | undefined): boolean {
  if (!email) return false;
  const editors = (env.CONTENT_EDITOR_EMAILS ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return editors.includes(email.trim().toLowerCase());
}

/** Signed-in content editors only */
export const contentEditorProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!isContentEditor(ctx.user.email)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Only content editors can do this' });
  }
  return next();
});
