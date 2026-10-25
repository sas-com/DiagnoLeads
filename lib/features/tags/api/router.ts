/**
 * Tags tRPC Router
 * Handles CRUD operations for tags and lead-tag associations
 */
import { leadTags, tags } from '@/lib/db/schema';
import { bulkTagLeadIdsSchema, leadTagIdsSchema } from '@/lib/features/tags/types/schemas';
import { assertInOrganization } from '@/lib/multi-tenant/helpers/scope';
import { organizationProcedure, router } from '@/lib/trpc/init';
import { TRPCError } from '@trpc/server';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

// Schemas
const createTagSchema = z.object({
  organizationId: z.string().uuid(),
  name: z.string().min(1).max(50),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .default('#3b82f6'),
  description: z.string().max(200).optional(),
});

const updateTagSchema = z.object({
  organizationId: z.string().uuid(),
  id: z.string().uuid(),
  name: z.string().min(1).max(50).optional(),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
  description: z.string().max(200).optional().nullable(),
});

const deleteTagSchema = z.object({
  organizationId: z.string().uuid(),
  id: z.string().uuid(),
});

const listTagsSchema = z.object({
  organizationId: z.string().uuid(),
});

const addTagToLeadSchema = z.object({
  organizationId: z.string().uuid(),
  leadId: z.string().uuid(),
  tagId: z.string().uuid(),
});

const removeTagFromLeadSchema = z.object({
  organizationId: z.string().uuid(),
  leadId: z.string().uuid(),
  tagId: z.string().uuid(),
});

const setLeadTagsSchema = z.object({
  organizationId: z.string().uuid(),
  leadId: z.string().uuid(),
  tagIds: leadTagIdsSchema,
});

const getLeadTagsSchema = z.object({
  organizationId: z.string().uuid(),
  leadId: z.string().uuid(),
});

export const tagsRouter = router({
  /**
   * List all tags for an organization
   */
  list: organizationProcedure.input(listTagsSchema).query(async ({ ctx, input }) => {
    if (!ctx.ability.can('read', 'Lead')) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'タグを閲覧する権限がありません',
      });
    }

    const result = await ctx.db
      .select()
      .from(tags)
      .where(eq(tags.organizationId, input.organizationId))
      .orderBy(tags.name);

    return result;
  }),

  /**
   * Create a new tag
   */
  create: organizationProcedure.input(createTagSchema).mutation(async ({ ctx, input }) => {
    if (!ctx.ability.can('create', 'Lead')) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'タグを作成する権限がありません',
      });
    }

    // Check for duplicate name
    const existing = await ctx.db.query.tags.findFirst({
      where: and(eq(tags.organizationId, input.organizationId), eq(tags.name, input.name)),
    });

    if (existing) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: '同じ名前のタグが既に存在します',
      });
    }

    const [tag] = await ctx.db
      .insert(tags)
      .values({
        organizationId: input.organizationId,
        name: input.name,
        color: input.color,
        description: input.description,
      })
      .returning();

    return tag;
  }),

  /**
   * Update a tag
   */
  update: organizationProcedure.input(updateTagSchema).mutation(async ({ ctx, input }) => {
    if (!ctx.ability.can('update', 'Lead')) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'タグを更新する権限がありません',
      });
    }

    const existing = await ctx.db.query.tags.findFirst({
      where: and(eq(tags.id, input.id), eq(tags.organizationId, input.organizationId)),
    });

    if (!existing) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'タグが見つかりません',
      });
    }

    // Check for duplicate name if name is being changed
    if (input.name && input.name !== existing.name) {
      const duplicate = await ctx.db.query.tags.findFirst({
        where: and(eq(tags.organizationId, input.organizationId), eq(tags.name, input.name)),
      });

      if (duplicate) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: '同じ名前のタグが既に存在します',
        });
      }
    }

    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (input.name !== undefined) updateData.name = input.name;
    if (input.color !== undefined) updateData.color = input.color;
    if (input.description !== undefined) updateData.description = input.description;

    const [updated] = await ctx.db
      .update(tags)
      .set(updateData)
      .where(and(eq(tags.id, input.id), eq(tags.organizationId, input.organizationId)))
      .returning();

    return updated;
  }),

  /**
   * Delete a tag
   */
  delete: organizationProcedure.input(deleteTagSchema).mutation(async ({ ctx, input }) => {
    if (!ctx.ability.can('delete', 'Lead')) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'タグを削除する権限がありません',
      });
    }

    const existing = await ctx.db.query.tags.findFirst({
      where: and(eq(tags.id, input.id), eq(tags.organizationId, input.organizationId)),
    });

    if (!existing) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'タグが見つかりません',
      });
    }

    await ctx.db
      .delete(tags)
      .where(and(eq(tags.id, input.id), eq(tags.organizationId, input.organizationId)));

    return { success: true };
  }),

  /**
   * Add a tag to a lead
   */
  addToLead: organizationProcedure.input(addTagToLeadSchema).mutation(async ({ ctx, input }) => {
    if (!ctx.ability.can('update', 'Lead')) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'リードを更新する権限がありません',
      });
    }

    await assertInOrganization(ctx.db, 'lead', input.organizationId, input.leadId);
    await assertInOrganization(ctx.db, 'tag', input.organizationId, input.tagId);

    // Check if already exists
    const existing = await ctx.db.query.leadTags.findFirst({
      where: and(eq(leadTags.leadId, input.leadId), eq(leadTags.tagId, input.tagId)),
    });

    if (existing) {
      return existing;
    }

    const [leadTag] = await ctx.db
      .insert(leadTags)
      .values({
        leadId: input.leadId,
        tagId: input.tagId,
      })
      .returning();

    return leadTag;
  }),

  /**
   * Remove a tag from a lead
   */
  removeFromLead: organizationProcedure
    .input(removeTagFromLeadSchema)
    .mutation(async ({ ctx, input }) => {
      if (!ctx.ability.can('update', 'Lead')) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'リードを更新する権限がありません',
        });
      }

      await assertInOrganization(ctx.db, 'lead', input.organizationId, input.leadId);
      await ctx.db
        .delete(leadTags)
        .where(and(eq(leadTags.leadId, input.leadId), eq(leadTags.tagId, input.tagId)));

      return { success: true };
    }),

  /**
   * Set all tags for a lead (replace existing)
   */
  setLeadTags: organizationProcedure.input(setLeadTagsSchema).mutation(async ({ ctx, input }) => {
    if (!ctx.ability.can('update', 'Lead')) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'リードを更新する権限がありません',
      });
    }

    // Both checked before anything is deleted
    await assertInOrganization(ctx.db, 'lead', input.organizationId, input.leadId);
    await assertInOrganization(ctx.db, 'tag', input.organizationId, input.tagIds);

    // Replaced in one transaction: a failed insert must not leave the lead without its tags
    const tagIds = [...new Set(input.tagIds)];
    await ctx.db.transaction(async (tx) => {
      await tx.delete(leadTags).where(eq(leadTags.leadId, input.leadId));
      if (tagIds.length > 0) {
        await tx.insert(leadTags).values(tagIds.map((tagId) => ({ leadId: input.leadId, tagId })));
      }
    });

    // Get updated tags
    const result = await ctx.db
      .select({
        tag: tags,
      })
      .from(leadTags)
      .innerJoin(tags, eq(leadTags.tagId, tags.id))
      .where(and(eq(leadTags.leadId, input.leadId), eq(tags.organizationId, input.organizationId)));

    return result.map((r) => r.tag);
  }),

  /**
   * Get tags for a lead
   */
  getLeadTags: organizationProcedure.input(getLeadTagsSchema).query(async ({ ctx, input }) => {
    if (!ctx.ability.can('read', 'Lead')) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'リードを閲覧する権限がありません',
      });
    }

    await assertInOrganization(ctx.db, 'lead', input.organizationId, input.leadId);

    const result = await ctx.db
      .select({
        tag: tags,
      })
      .from(leadTags)
      .innerJoin(tags, eq(leadTags.tagId, tags.id))
      .where(and(eq(leadTags.leadId, input.leadId), eq(tags.organizationId, input.organizationId)));

    return result.map((r) => r.tag);
  }),

  /**
   * Bulk set tags for multiple leads
   */
  bulkSetLeadTags: organizationProcedure
    .input(
      z.object({
        organizationId: z.string().uuid(),
        leadIds: bulkTagLeadIdsSchema,
        tagIds: leadTagIdsSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.ability.can('update', 'Lead')) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'リードを更新する権限がありません',
        });
      }

      // Both checked before anything is deleted
      await assertInOrganization(ctx.db, 'lead', input.organizationId, input.leadIds);
      await assertInOrganization(ctx.db, 'tag', input.organizationId, input.tagIds);

      // Replaced in one transaction: a failed insert must not leave the leads without their tags
      const leadIds = [...new Set(input.leadIds)];
      const tagIds = [...new Set(input.tagIds)];
      await ctx.db.transaction(async (tx) => {
        await tx.delete(leadTags).where(inArray(leadTags.leadId, leadIds));
        if (tagIds.length > 0 && leadIds.length > 0) {
          await tx
            .insert(leadTags)
            .values(leadIds.flatMap((leadId) => tagIds.map((tagId) => ({ leadId, tagId }))));
        }
      });

      return { success: true, updatedCount: input.leadIds.length };
    }),
});
