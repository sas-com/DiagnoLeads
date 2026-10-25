/**
 * Comments tRPC Router
 * Handles CRUD operations for lead comments and notes
 *
 * Every write leaves one `audit_logs` row in the same transaction (resource 'lead_comment',
 * resourceId = comment id, metadata.leadId), without the text: memos may name people, and the
 * lead audit keeps no contact details either (#101, #555).
 */
import type { db as defaultDb } from '@/lib/db/client';
import { type AuditAction, type LeadComment, auditLogs, leadComments } from '@/lib/db/schema';
import { assertInOrganization } from '@/lib/multi-tenant/helpers/scope';
import { organizationProcedure, router } from '@/lib/trpc/init';
import { TRPCError } from '@trpc/server';
import { and, count, desc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { canReadComments, canWriteComments } from '../access';

type Transaction = Parameters<Parameters<(typeof defaultDb)['transaction']>[0]>[0];

export const COMMENT_AUDIT_RESOURCE = 'lead_comment';

/** One audit row for a write to a comment (Refs #555) */
function auditComment(
  tx: Transaction,
  input: {
    organizationId: string;
    userId: string;
    action: AuditAction;
    comment: Pick<LeadComment, 'id' | 'leadId'>;
    changes?: { before?: unknown; after?: unknown };
    metadata?: Record<string, unknown>;
  }
) {
  return tx.insert(auditLogs).values({
    organizationId: input.organizationId,
    userId: input.userId,
    action: input.action,
    resource: COMMENT_AUDIT_RESOURCE,
    resourceId: input.comment.id,
    changes: input.changes,
    metadata: { leadId: input.comment.leadId, ...input.metadata },
  });
}

// Schemas
/** Metadata stays small: it is stored with the comment and nothing reads it yet */
const METADATA_MAX_LENGTH = 2000;
const metadataSchema = z
  .record(z.unknown())
  .refine((value) => JSON.stringify(value).length <= METADATA_MAX_LENGTH, {
    message: 'metadata is too large',
  });

const createCommentSchema = z.object({
  organizationId: z.string().uuid(),
  leadId: z.string().uuid(),
  content: z.string().min(1).max(5000),
  // Activity entries are written by addActivity; the screen offers comments and notes only
  type: z.enum(['comment', 'note']).default('comment'),
  parentId: z.string().uuid().optional(),
  metadata: metadataSchema.optional(),
});

const updateCommentSchema = z.object({
  organizationId: z.string().uuid(),
  id: z.string().uuid(),
  content: z.string().min(1).max(5000),
});

const deleteCommentSchema = z.object({
  organizationId: z.string().uuid(),
  id: z.string().uuid(),
});

const listCommentsSchema = z.object({
  organizationId: z.string().uuid(),
  leadId: z.string().uuid(),
  type: z.enum(['comment', 'note', 'activity', 'all']).default('all'),
  limit: z.number().min(1).max(100).default(50),
  offset: z.number().min(0).default(0),
});

const togglePinSchema = z.object({
  organizationId: z.string().uuid(),
  id: z.string().uuid(),
});

export const commentsRouter = router({
  /**
   * List comments for a lead
   */
  list: organizationProcedure.input(listCommentsSchema).query(async ({ ctx, input }) => {
    if (!canReadComments(ctx)) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'コメントを閲覧する権限がありません',
      });
    }

    const conditions = [
      eq(leadComments.leadId, input.leadId),
      eq(leadComments.organizationId, input.organizationId),
      isNull(leadComments.parentId), // Only top-level comments
    ];

    if (input.type !== 'all') {
      conditions.push(eq(leadComments.type, input.type));
    }

    const results = await ctx.db.query.leadComments.findMany({
      where: and(...conditions),
      orderBy: [desc(leadComments.isPinned), desc(leadComments.createdAt)],
      limit: input.limit,
      offset: input.offset,
      with: {
        user: {
          columns: {
            id: true,
            name: true,
            email: true,
            image: true,
          },
        },
        replies: {
          // Replies of the same organization only, however the row was written
          where: eq(leadComments.organizationId, input.organizationId),
          with: {
            user: {
              columns: {
                id: true,
                name: true,
                email: true,
                image: true,
              },
            },
          },
          orderBy: [leadComments.createdAt],
        },
      },
    });

    const [total] = await ctx.db
      .select({ value: count() })
      .from(leadComments)
      .where(and(...conditions));

    return {
      items: results,
      total: total?.value ?? 0,
      limit: input.limit,
      offset: input.offset,
      // What the screen offers: the checks of the writes below (others' comments are edited and
      // deleted by their author or an owner only)
      viewer: {
        userId: ctx.session.user.id,
        canWrite: canWriteComments(ctx),
        canModerate: ctx.ability.can('manage', 'all'),
      },
    };
  }),

  /**
   * Create a new comment
   */
  create: organizationProcedure.input(createCommentSchema).mutation(async ({ ctx, input }) => {
    if (!canWriteComments(ctx)) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'コメントを作成する権限がありません',
      });
    }

    await assertInOrganization(ctx.db, 'lead', input.organizationId, input.leadId);
    if (input.parentId) {
      // A reply stays in the thread of the same lead, one level deep (a reply to a reply would
      // never be listed, nor deleted with its thread)
      const [parent] = await ctx.db
        .select({ id: leadComments.id })
        .from(leadComments)
        .where(
          and(
            eq(leadComments.id, input.parentId),
            eq(leadComments.organizationId, input.organizationId),
            eq(leadComments.leadId, input.leadId),
            isNull(leadComments.parentId)
          )
        )
        .limit(1);
      if (!parent) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'The parent comment was not found' });
      }
    }

    const comment = await ctx.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(leadComments)
        .values({
          leadId: input.leadId,
          userId: ctx.session.user.id,
          organizationId: input.organizationId,
          content: input.content,
          type: input.type,
          parentId: input.parentId,
          metadata: input.metadata,
        })
        .returning();
      await auditComment(tx, {
        organizationId: input.organizationId,
        userId: ctx.session.user.id,
        action: 'create',
        comment: row,
        changes: { after: { type: row.type, parentId: row.parentId } },
      });
      return row;
    });

    // Fetch with user info
    const result = await ctx.db.query.leadComments.findFirst({
      where: and(
        eq(leadComments.id, comment.id),
        eq(leadComments.organizationId, input.organizationId)
      ),
      with: {
        user: {
          columns: {
            id: true,
            name: true,
            email: true,
            image: true,
          },
        },
      },
    });

    return result;
  }),

  /**
   * Update a comment
   */
  update: organizationProcedure.input(updateCommentSchema).mutation(async ({ ctx, input }) => {
    if (!canWriteComments(ctx)) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'コメントを更新する権限がありません',
      });
    }

    // Verify comment exists and user owns it
    const existing = await ctx.db.query.leadComments.findFirst({
      where: and(
        eq(leadComments.id, input.id),
        eq(leadComments.organizationId, input.organizationId)
      ),
    });

    if (!existing) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'コメントが見つかりません',
      });
    }

    // Only allow editing own comments (unless admin)
    if (existing.userId !== ctx.session.user.id && !ctx.ability.can('manage', 'all')) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: '自分のコメントのみ編集できます',
      });
    }

    // The same text is no edit: nothing is written, the comment does not read as edited
    if (input.content === existing.content) return existing;

    return ctx.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(leadComments)
        .set({
          content: input.content,
          updatedAt: new Date(),
        })
        .where(
          and(eq(leadComments.id, input.id), eq(leadComments.organizationId, input.organizationId))
        )
        .returning();
      // Deleted meanwhile: nothing changed, nothing is recorded
      if (!updated) throw new TRPCError({ code: 'NOT_FOUND', message: 'コメントが見つかりません' });
      await auditComment(tx, {
        organizationId: input.organizationId,
        userId: ctx.session.user.id,
        action: 'update',
        comment: existing,
        // Only that the text changed, never the text
        metadata: { changedText: ['content'] },
      });
      return updated;
    });
  }),

  /**
   * Delete a comment
   */
  delete: organizationProcedure.input(deleteCommentSchema).mutation(async ({ ctx, input }) => {
    if (!canWriteComments(ctx)) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'コメントを削除する権限がありません',
      });
    }

    const existing = await ctx.db.query.leadComments.findFirst({
      where: and(
        eq(leadComments.id, input.id),
        eq(leadComments.organizationId, input.organizationId)
      ),
    });

    if (!existing) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'コメントが見つかりません',
      });
    }

    // Only allow deleting own comments (unless admin)
    if (existing.userId !== ctx.session.user.id && !ctx.ability.can('manage', 'all')) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: '自分のコメントのみ削除できます',
      });
    }

    await ctx.db.transaction(async (tx) => {
      // Replies answer their comment and would stay in the lead's activity on their own
      // (parent_id has no foreign key): they go with it. Others' replies are deleted only by
      // those who may delete anyone's comment, as one by one
      const replies = await tx
        .select({
          id: leadComments.id,
          userId: leadComments.userId,
          type: leadComments.type,
          isPinned: leadComments.isPinned,
        })
        .from(leadComments)
        .where(
          and(
            eq(leadComments.parentId, existing.id),
            eq(leadComments.organizationId, input.organizationId)
          )
        )
        .for('update');
      if (
        replies.some((reply) => reply.userId !== ctx.session.user.id) &&
        !ctx.ability.can('manage', 'all')
      ) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'ほかの人の返信があるコメントは削除できません',
        });
      }
      const deleted = await tx
        .delete(leadComments)
        .where(
          and(eq(leadComments.id, input.id), eq(leadComments.organizationId, input.organizationId))
        )
        .returning({ id: leadComments.id });
      // Deleted meanwhile: nothing to record
      if (deleted.length === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'コメントが見つかりません' });
      }
      for (const reply of replies) {
        await tx
          .delete(leadComments)
          .where(
            and(
              eq(leadComments.id, reply.id),
              eq(leadComments.organizationId, input.organizationId)
            )
          );
        await auditComment(tx, {
          organizationId: input.organizationId,
          userId: ctx.session.user.id,
          action: 'delete',
          comment: { id: reply.id, leadId: existing.leadId },
          changes: {
            before: { type: reply.type, isPinned: reply.isPinned, authorId: reply.userId },
          },
          metadata: { parentId: existing.id },
        });
      }
      await auditComment(tx, {
        organizationId: input.organizationId,
        userId: ctx.session.user.id,
        action: 'delete',
        comment: existing,
        changes: {
          before: { type: existing.type, isPinned: existing.isPinned, authorId: existing.userId },
        },
        metadata: replies.length > 0 ? { replies: replies.length } : undefined,
      });
    });

    return { success: true };
  }),

  /**
   * Toggle pin status of a comment
   */
  togglePin: organizationProcedure.input(togglePinSchema).mutation(async ({ ctx, input }) => {
    if (!canWriteComments(ctx)) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'コメントをピン留めする権限がありません',
      });
    }

    const existing = await ctx.db.query.leadComments.findFirst({
      where: and(
        eq(leadComments.id, input.id),
        eq(leadComments.organizationId, input.organizationId)
      ),
    });

    if (!existing) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'コメントが見つかりません',
      });
    }

    return ctx.db.transaction(async (tx) => {
      // Not an edit of the text: updatedAt stays, so the comment does not read as edited.
      // Flipped in SQL, so two pins at once record what each one did
      const [updated] = await tx
        .update(leadComments)
        .set({ isPinned: sql`not ${leadComments.isPinned}` })
        .where(
          and(eq(leadComments.id, input.id), eq(leadComments.organizationId, input.organizationId))
        )
        .returning();
      if (!updated) throw new TRPCError({ code: 'NOT_FOUND', message: 'コメントが見つかりません' });
      await auditComment(tx, {
        organizationId: input.organizationId,
        userId: ctx.session.user.id,
        action: 'update',
        comment: existing,
        changes: { before: { isPinned: !updated.isPinned }, after: { isPinned: updated.isPinned } },
      });
      return updated;
    });
  }),

  /**
   * Add activity log entry
   */
  addActivity: organizationProcedure
    .input(
      z.object({
        organizationId: z.string().uuid(),
        leadId: z.string().uuid(),
        content: z.string().min(1).max(1000),
        metadata: metadataSchema.optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!canWriteComments(ctx)) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'アクティビティを記録する権限がありません',
        });
      }

      await assertInOrganization(ctx.db, 'lead', input.organizationId, input.leadId);

      return ctx.db.transaction(async (tx) => {
        const [activity] = await tx
          .insert(leadComments)
          .values({
            leadId: input.leadId,
            userId: ctx.session.user.id,
            organizationId: input.organizationId,
            content: input.content,
            type: 'activity',
            metadata: input.metadata,
          })
          .returning();
        await auditComment(tx, {
          organizationId: input.organizationId,
          userId: ctx.session.user.id,
          action: 'create',
          comment: activity,
          changes: { after: { type: activity.type, parentId: null } },
        });
        return activity;
      });
    }),

  /**
   * Get comment count for a lead
   */
  getCount: organizationProcedure
    .input(
      z.object({
        organizationId: z.string().uuid(),
        leadId: z.string().uuid(),
      })
    )
    .query(async ({ ctx, input }) => {
      if (!canReadComments(ctx)) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'コメントを閲覧する権限がありません',
        });
      }

      const [result] = await ctx.db
        .select({ value: count() })
        .from(leadComments)
        .where(
          and(
            eq(leadComments.leadId, input.leadId),
            eq(leadComments.organizationId, input.organizationId)
          )
        );

      return { count: result?.value ?? 0 };
    }),
});
