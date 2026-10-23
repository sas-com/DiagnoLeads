/**
 * Lead suggestions for the header search box (#164): leads of the current organization whose
 * name, email or company contains the text.
 */
import { leads } from '@/lib/db/schema';
import { organizationProcedure, router } from '@/lib/trpc/init';
import { TRPCError } from '@trpc/server';
import { and, desc, eq, ilike, or } from 'drizzle-orm';
import { z } from 'zod';

export const LEAD_SUGGESTION_LIMIT = 8;

export const suggestLeadsSchema = z.object({
  organizationId: z.string().uuid(),
  query: z.string().trim().min(1).max(100),
  limit: z.number().int().min(1).max(20).default(LEAD_SUGGESTION_LIMIT),
});

/** Escape LIKE wildcards so the text is matched literally */
export function escapeLikePattern(text: string): string {
  return text.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export const leadSearchRouter = router({
  suggest: organizationProcedure.input(suggestLeadsSchema).query(async ({ ctx, input }) => {
    // Names, addresses and companies of leads: same rule as the leads list (#356)
    if (!ctx.ability.can('read', 'Lead')) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'リードを閲覧する権限がありません' });
    }
    const pattern = `%${escapeLikePattern(input.query)}%`;
    return ctx.db
      .select({
        id: leads.id,
        name: leads.name,
        email: leads.email,
        company: leads.company,
        status: leads.status,
      })
      .from(leads)
      .where(
        and(
          eq(leads.organizationId, input.organizationId),
          or(ilike(leads.name, pattern), ilike(leads.email, pattern), ilike(leads.company, pattern))
        )
      )
      .orderBy(desc(leads.updatedAt))
      .limit(input.limit);
  }),
});
