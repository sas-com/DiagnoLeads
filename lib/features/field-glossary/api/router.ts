/**
 * Field glossary tRPC router (Epic #780 P0b).
 *
 * The dictionary is site-wide: read by every authenticated user and not scoped by organization
 * (decision 2026-10-26-field-glossary-site-wide; read unscoped like CMS content). It holds no
 * organization data, so this uses protectedProcedure rather than organizationProcedure
 * (.claude/rules/api-routers.md scopes organizationProcedure to organization data). Writes, which
 * only operator content editors may do, are added as a separate procedure with the admin edit
 * page, behind a security review.
 */

import { protectedProcedure, router } from '@/lib/trpc/init';
import { getFieldGlossaryEntries } from '../service';
import { getFieldGlossarySchema } from '../types/schemas';

export const fieldGlossaryRouter = router({
  /** Help entries (field-level and value-level) for the given field keys, for input popovers */
  getByKeys: protectedProcedure.input(getFieldGlossarySchema).query(async ({ ctx, input }) => {
    const entries = await getFieldGlossaryEntries(ctx.db, input.keys);
    return { entries };
  }),
});
