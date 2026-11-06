/**
 * Field glossary tRPC router (Epic #780 P0b).
 *
 * The dictionary is site-wide: read by every authenticated user and not scoped by organization
 * (decision 2026-10-26-field-glossary-site-wide; read unscoped like CMS content). It holds no
 * organization data, so the read uses protectedProcedure rather than organizationProcedure
 * (.claude/rules/api-routers.md scopes organizationProcedure to organization data).
 *
 * Editing (#800) goes through organizationProcedure only to learn the caller's role in their
 * organization: owners and admins of the operator's organization are the editors
 * (decision 2026-11-06-field-glossary-editors). Editors write only the listed fields and values
 * (GLOSSARY_FIELDS).
 */

import { organizationProcedure, protectedProcedure, router } from '@/lib/trpc/init';
import { TRPCError } from '@trpc/server';
import { canEditFieldGlossary } from '../editors';
import {
  deleteFieldGlossaryEntry,
  getFieldGlossaryEntries,
  upsertFieldGlossaryEntry,
} from '../service';
import { GLOSSARY_FIELD_KEYS, glossaryEntryPosition } from '../types/fields';
import {
  deleteFieldGlossarySchema,
  getFieldGlossarySchema,
  listFieldGlossaryForEditorSchema,
  upsertFieldGlossarySchema,
} from '../types/schemas';

const FORBIDDEN_MESSAGE =
  'Only owners and admins of the operating organization may edit the field glossary';

export const fieldGlossaryRouter = router({
  /** Help entries (field-level and value-level) for the given field keys, for input popovers */
  getByKeys: protectedProcedure.input(getFieldGlossarySchema).query(async ({ ctx, input }) => {
    const entries = await getFieldGlossaryEntries(ctx.db, input.keys);
    return { entries };
  }),

  /** Every entry of the listed fields, for the edit page; editors only */
  listForEditor: organizationProcedure
    .input(listFieldGlossaryForEditorSchema)
    .query(async ({ ctx }) => {
      if (!canEditFieldGlossary(ctx.organization.id, ctx.membership.role)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: FORBIDDEN_MESSAGE });
      }
      const entries = await getFieldGlossaryEntries(ctx.db, [...GLOSSARY_FIELD_KEYS]);
      return { entries };
    }),

  /** Write the help of a listed field or one of its listed values; editors only */
  upsert: organizationProcedure
    .input(upsertFieldGlossarySchema)
    .mutation(async ({ ctx, input }) => {
      if (!canEditFieldGlossary(ctx.organization.id, ctx.membership.role)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: FORBIDDEN_MESSAGE });
      }
      const position = glossaryEntryPosition(input.fieldKey, input.value);
      if (!position) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'This field or value is not in the field glossary list',
        });
      }
      const entry = await upsertFieldGlossaryEntry(ctx.db, {
        fieldKey: input.fieldKey,
        value: input.value,
        descriptionJa: input.descriptionJa,
        descriptionEn: input.descriptionEn,
        sortOrder: position.sortOrder,
        updatedBy: ctx.user.id,
      });
      return { entry };
    }),

  /** Delete one entry, so the screens show no help for it; editors only */
  delete: organizationProcedure
    .input(deleteFieldGlossarySchema)
    .mutation(async ({ ctx, input }) => {
      if (!canEditFieldGlossary(ctx.organization.id, ctx.membership.role)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: FORBIDDEN_MESSAGE });
      }
      const deleted = await deleteFieldGlossaryEntry(ctx.db, input.id);
      if (!deleted) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Field glossary entry not found' });
      }
      return { success: true };
    }),
});
