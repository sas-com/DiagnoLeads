/**
 * Field glossary tRPC router (Epic #780 P0b).
 *
 * Reads are site-wide and open to every authenticated user (protectedProcedure), not scoped by
 * organization (decision 2026-10-26-field-glossary-site-wide; read unscoped like CMS content). It
 * holds no organization data, so organizationProcedure is not used (.claude/rules/api-routers.md
 * scopes that to organization data). Writes (list for the edit page, upsert, delete) are
 * restricted to owners/admins of the operator organization (owner decision 2026-11-06, #800).
 */

import { protectedProcedure, router } from '@/lib/trpc/init';
import { TRPCError } from '@trpc/server';
import {
  canEditFieldGlossary,
  deleteFieldGlossaryEntry,
  getFieldGlossaryEntries,
  isUniqueViolation,
  listFieldGlossaryEntries,
  upsertFieldGlossaryEntry,
} from '../service';
import {
  FIELD_GLOSSARY_LIST_LIMIT,
  deleteFieldGlossarySchema,
  getFieldGlossarySchema,
  upsertFieldGlossarySchema,
} from '../types/schemas';

/** Blank (after trimming) becomes null, so no dead empty strings are stored */
function blankToNull(text: string | null): string | null {
  const trimmed = text?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

/** Only an owner/admin of the operator organization may edit the site-wide glossary */
const operatorEditorProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  if (!(await canEditFieldGlossary(ctx.db, ctx.user.id))) {
    throw new TRPCError({ code: 'FORBIDDEN', message: '項目辞書を編集する権限がありません' });
  }
  return next();
});

export const fieldGlossaryRouter = router({
  /** Help entries (field-level and value-level) for the given field keys, for input popovers */
  getByKeys: protectedProcedure.input(getFieldGlossarySchema).query(async ({ ctx, input }) => {
    const entries = await getFieldGlossaryEntries(ctx.db, input.keys);
    return { entries };
  }),

  /** Every entry, for the operator's edit page */
  list: operatorEditorProcedure.query(async ({ ctx }) => {
    const entries = await listFieldGlossaryEntries(ctx.db, FIELD_GLOSSARY_LIST_LIMIT);
    return { entries };
  }),

  /** Create a new entry, or update the one with the given id */
  upsert: operatorEditorProcedure
    .input(upsertFieldGlossarySchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const entry = await upsertFieldGlossaryEntry(ctx.db, {
          id: input.id,
          fieldKey: input.fieldKey,
          value: input.value,
          labelJa: blankToNull(input.labelJa),
          labelEn: blankToNull(input.labelEn),
          descriptionJa: blankToNull(input.descriptionJa),
          descriptionEn: blankToNull(input.descriptionEn),
          sortOrder: input.sortOrder,
          updatedBy: ctx.user.id,
        });
        if (!entry) throw new TRPCError({ code: 'NOT_FOUND', message: '項目が見つかりません' });
        return entry;
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new TRPCError({ code: 'CONFLICT', message: 'その項目／値の説明はすでにあります' });
        }
        throw error;
      }
    }),

  /** Delete an entry */
  delete: operatorEditorProcedure
    .input(deleteFieldGlossarySchema)
    .mutation(async ({ ctx, input }) => {
      const removed = await deleteFieldGlossaryEntry(ctx.db, input.id);
      if (!removed) throw new TRPCError({ code: 'NOT_FOUND', message: '項目が見つかりません' });
      return { id: input.id };
    }),
});
