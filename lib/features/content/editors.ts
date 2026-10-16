import type { Database } from '@/lib/db/client';
import { contentEditors, organizationMembers } from '@/lib/db/schema';
import { env } from '@/lib/env';
import { resolveDiagnosisOrganizationId } from '@/lib/features/diagnostics/organization';
import { protectedProcedure } from '@/lib/trpc/init';
import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';

/**
 * Whether the email is listed in CONTENT_EDITOR_EMAILS (comma-separated, case-insensitive).
 * Kept as a fallback for when nobody can grant editors from the settings screen (#87, #91).
 */
export function isListedContentEditor(email: string | null | undefined): boolean {
  if (!email) return false;
  const editors = (env.CONTENT_EDITOR_EMAILS ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return editors.includes(email.trim().toLowerCase());
}

/**
 * Who may edit FAQs and blog posts (#87, #91):
 * - users listed in CONTENT_EDITOR_EMAILS, or
 * - users granted on the settings screen (content_editors) who are still members of the
 *   operating organization. Without an operating organization only the email list applies.
 * Nobody else, including owners / admins who have not been granted.
 */
export async function isContentEditor(
  db: Database,
  user: { id: string; email?: string | null } | null | undefined
): Promise<boolean> {
  if (!user) return false;
  if (isListedContentEditor(user.email)) return true;

  const organizationId = resolveDiagnosisOrganizationId();
  if (!organizationId) return false;

  const [grant] = await db
    .select({ userId: contentEditors.userId })
    .from(contentEditors)
    .where(eq(contentEditors.userId, user.id))
    .limit(1);
  if (!grant) return false;

  // A grant stops counting once the user leaves the operating organization
  const membership = await db.query.organizationMembers.findFirst({
    columns: { id: true },
    where: and(
      eq(organizationMembers.userId, user.id),
      eq(organizationMembers.organizationId, organizationId)
    ),
  });
  return Boolean(membership);
}

/** Signed-in content editors only */
export const contentEditorProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  if (!(await isContentEditor(ctx.db, ctx.user))) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Only content editors can do this' });
  }
  return next();
});
