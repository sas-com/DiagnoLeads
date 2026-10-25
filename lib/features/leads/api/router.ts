import type { db as defaultDb } from '@/lib/db/client';
import { auditLogs, leadTags, leads, tags, users } from '@/lib/db/schema';
import { canReadComments } from '@/lib/features/comments/service';
import type { AxMqlLevel } from '@/lib/features/diagnostics/ax-migration/mql';
import { isFirstHandoff } from '@/lib/features/lead-handoff/handoff';
import { notifyLeadHandoff } from '@/lib/features/lead-handoff/notify';
import {
  type LeadEvent,
  emitLeadEvents,
  leadChangeEvents,
} from '@/lib/features/webhooks/services/lead-events';
import { organizationProcedure, router } from '@/lib/trpc/init';
import { TRPCError } from '@trpc/server';
import { type SQL, and, count, eq, inArray, sql } from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import {
  findAssignableMember,
  findUserName,
  getIntakeUserIds,
  listAssignableMembers,
  listIntakeMembers,
  memberDisplayName,
  setIntakeUserIds,
} from '../assignment';
import { notifyLeadAssigned } from '../assignment-notify';
import {
  creationAuditValues,
  diffLeadAudit,
  leadAuditSnapshot,
  writeLeadAuditLogs,
} from '../audit';
import {
  LEAD_EXPORT_MAX_ROWS,
  LEAD_EXPORT_MIME_TYPES,
  type LeadExportRow,
  exportAuditFilters,
  leadExportCsv,
  leadExportFilename,
  leadExportJson,
} from '../export';
import { leadExportPdfBase64 } from '../export-pdf';
import { getNextMeetingRate, getWeekMeetings } from '../meetings';
import {
  LEAD_STATUSES,
  LOST_ON_HOLD_MESSAGE,
  type LeadPipelineFields,
  type LeadStatus,
  dropsOnHoldReason,
  jstDate,
  makesLostOnHold,
  qualificationUpdateFields,
  statusUpdateFields,
} from '../types/pipeline';
import {
  assignLeadSchema,
  bulkCreateSchema,
  bulkDeleteSchema,
  bulkUpdateStatusSchema,
  createLeadSchema,
  deleteLeadSchema,
  exportLeadsSchema,
  getLeadSchema,
  listLeadsSchema,
  setLeadIntakeSchema,
  updateLeadSchema,
} from '../types/schemas';
import {
  leadDealRating,
  leadLastActivityAt,
  leadListConditions,
  leadListOrderBy,
  leadMqlLevel,
  leadNextMeetingDate,
  parseUtcTimestamp,
} from './list-sql';

/**
 * Pick only the pipeline fields that were explicitly provided
 */
function pickPipelineFields(input: LeadPipelineFields): LeadPipelineFields {
  const keys = [
    'inflowSource',
    'conversionPoint',
    'dealPhase',
    'targetSystem',
    'referrerName',
    'lostReason',
    'agencyName',
    'acquisitionCost',
  ] as const;
  const picked: Record<string, unknown> = {};
  for (const key of keys) {
    if (input[key] !== undefined) picked[key] = input[key];
  }
  return picked as LeadPipelineFields;
}

type ListFilterInput = Omit<z.infer<typeof listLeadsSchema>, 'limit' | 'offset'>;

/**
 * WHERE of the list and the export: always scoped to the organization (#131), with the list
 * filters and the tag filter. null when the tag filter matches no lead.
 */
async function listWhere(
  ctx: { db: typeof defaultDb; user: { id: string } },
  input: ListFilterInput
): Promise<SQL | null> {
  const conditions: SQL[] = [
    eq(leads.organizationId, input.organizationId),
    ...leadListConditions(input, ctx.user.id),
  ];

  // Tag filter - get lead IDs that have the specified tags
  if (input.tagIds && input.tagIds.length > 0) {
    const leadsWithTags = await ctx.db
      .select({ leadId: leadTags.leadId })
      .from(leadTags)
      .where(inArray(leadTags.tagId, input.tagIds))
      .groupBy(leadTags.leadId);
    if (leadsWithTags.length === 0) return null;
    conditions.push(
      inArray(
        leads.id,
        leadsWithTags.map((lt) => lt.leadId)
      )
    );
  }

  return and(...conditions) ?? null;
}

/** Values of the lead's latest hearing shown with the lead (#137) */
const LATEST_HEARING_EXTRAS = {
  nextMeetingDate: sql<string | null>`${leadNextMeetingDate}`.as('next_meeting_date'),
  dealRating: sql<string | null>`${leadDealRating}`.as('deal_rating'),
};

/** What the lead views show of the assignee (#135) */
const ASSIGNEE_COLUMNS = { id: true, name: true, email: true } as const;

/** Intake members (窓口) are chosen by the organization's owners and admins (#135) */
const INTAKE_EDITOR_ROLES: readonly string[] = ['owner', 'admin', 'group_owner'];

/**
 * Leads tRPC router
 * Handles CRUD operations for leads with multi-tenant isolation
 */
export const leadsRouter = router({
  /**
   * What the current member may do with leads, so read-only roles (parent_viewer etc.) get no
   * edit controls. The mutations check the same abilities (Refs #109)
   */
  access: organizationProcedure.query(({ ctx }) => ({
    canCreate: ctx.ability.can('create', 'Lead'),
    canEdit: ctx.ability.can('update', 'Lead'),
    canDelete: ctx.ability.can('delete', 'Lead'),
    // The comments tab of the lead page (#555); the comments router checks the same rule
    canReadComments: canReadComments(ctx),
  })),

  /**
   * Create a new lead
   */
  create: organizationProcedure.input(createLeadSchema).mutation(async ({ ctx, input }) => {
    // Check permission
    if (!ctx.ability.can('create', 'Lead')) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'リードを作成する権限がありません',
      });
    }
    if (makesLostOnHold(null, input)) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: LOST_ON_HOLD_MESSAGE });
    }

    const now = new Date();
    // Create the lead and its audit row together (Refs #101)
    const created = await ctx.db.transaction(async (tx) => {
      const [lead] = await tx
        .insert(leads)
        .values({
          organizationId: input.organizationId,
          email: input.email,
          name: input.name,
          company: input.company,
          phone: input.phone,
          ...statusUpdateFields(input.status),
          score: input.score,
          source: input.source,
          responses: input.responses,
          ...pickPipelineFields(input),
          ...qualificationUpdateFields(input, null, now),
          ...(input.dealPhase ? { dealPhaseReachedAt: { [input.dealPhase]: jstDate(now) } } : {}),
        })
        .returning();

      if (lead) {
        await writeLeadAuditLogs(
          tx,
          { organizationId: input.organizationId, userId: ctx.user.id, at: now },
          [{ action: 'create', leadId: lead.id, after: creationAuditValues(lead) }]
        );
      }
      return lead;
    });
    if (created) {
      emitLeadEvents(input.organizationId, [{ type: 'lead.created', lead: created }], {
        database: ctx.db,
      });
    }
    return created;
  }),

  /**
   * Get lead by ID
   */
  get: organizationProcedure.input(getLeadSchema).query(async ({ ctx, input }) => {
    // Check permission
    if (!ctx.ability.can('read', 'Lead')) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'リードを閲覧する権限がありません',
      });
    }

    const lead = await ctx.db.query.leads.findFirst({
      where: and(eq(leads.id, input.id), eq(leads.organizationId, input.organizationId)),
      extras: LATEST_HEARING_EXTRAS,
      with: {
        assignee: { columns: ASSIGNEE_COLUMNS },
        leadTags: {
          with: {
            tag: true,
          },
        },
      },
    });

    if (!lead) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'リードが見つかりません',
      });
    }

    // Transform to include tags array
    return {
      ...lead,
      tags: lead.leadTags.map((lt) => lt.tag),
    };
  }),

  /**
   * List leads with pagination and filtering
   */
  list: organizationProcedure.input(listLeadsSchema).query(async ({ ctx, input }) => {
    // Check permission
    if (!ctx.ability.can('read', 'Lead')) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'リードを閲覧する権限がありません',
      });
    }

    const where = await listWhere(ctx, input);
    if (!where) {
      // No leads match the tag filter
      return { items: [], total: 0, limit: input.limit, offset: input.offset };
    }

    // Total of all matching leads (for the page count), and the requested page
    const [countRows, results] = await Promise.all([
      ctx.db.select({ total: count() }).from(leads).where(where),
      ctx.db.query.leads.findMany({
        where,
        // The search vectors (1536 floats and a tsvector per lead) are never shown (#433)
        columns: { embedding: false, searchVector: false },
        orderBy: leadListOrderBy(input.sortBy, input.sortOrder),
        limit: input.limit,
        offset: input.offset,
        extras: {
          lastActivityAt: sql<string>`${leadLastActivityAt}`.as('last_activity_at'),
          // 関心あり / 適合 for the list's MQL badge (#196)
          mqlLevel: sql<AxMqlLevel | null>`${leadMqlLevel}`.as('mql_level'),
          ...LATEST_HEARING_EXTRAS,
        },
        with: {
          assignee: { columns: ASSIGNEE_COLUMNS },
          leadTags: {
            with: {
              tag: true,
            },
          },
        },
      }),
    ]);

    // Transform results to include tags array
    const itemsWithTags = results.map((lead) => ({
      ...lead,
      lastActivityAt: parseUtcTimestamp(lead.lastActivityAt),
      tags: lead.leadTags.map((lt) => lt.tag),
    }));

    return {
      items: itemsWithTags,
      total: Number(countRows[0]?.total ?? 0),
      limit: input.limit,
      offset: input.offset,
    };
  }),

  /**
   * Export every lead matching the list's filters and sort (#173), up to LEAD_EXPORT_MAX_ROWS.
   * Same permission as reading the list. The file is made here and one audit row records who
   * exported what (format, row count, filters without personal data).
   */
  export: organizationProcedure.input(exportLeadsSchema).mutation(async ({ ctx, input }) => {
    if (!ctx.ability.can('read', 'Lead')) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'リードを閲覧する権限がありません',
      });
    }
    const { format, locale, ...filterInput } = input;
    const now = new Date();
    const where = await listWhere(ctx, filterInput);

    let total = 0;
    let rows: LeadExportRow[] = [];
    if (where) {
      const [countRows, selected] = await Promise.all([
        ctx.db.select({ total: count() }).from(leads).where(where),
        ctx.db
          .select({
            id: leads.id,
            name: leads.name,
            email: leads.email,
            company: leads.company,
            phone: leads.phone,
            status: leads.status,
            dealPhase: leads.dealPhase,
            score: leads.score,
            source: leads.source,
            inflowSource: leads.inflowSource,
            assignee: sql<string | null>`coalesce(nullif(trim(${users.name}), ''), ${users.email})`,
            nextMeetingDate: leadNextMeetingDate,
            dealRating: leadDealRating,
            createdAt: leads.createdAt,
          })
          .from(leads)
          .leftJoin(users, eq(users.id, leads.assigneeUserId))
          .where(where)
          .orderBy(...leadListOrderBy(input.sortBy, input.sortOrder))
          .limit(LEAD_EXPORT_MAX_ROWS),
      ]);
      total = Number(countRows[0]?.total ?? 0);
      rows = selected;
    }
    const capped = total > rows.length;

    const content =
      format === 'csv'
        ? leadExportCsv(rows)
        : format === 'json'
          ? leadExportJson(rows)
          : leadExportPdfBase64(rows, { generatedAt: now, locale });

    await ctx.db.insert(auditLogs).values({
      organizationId: input.organizationId,
      userId: ctx.user.id,
      action: 'export',
      resource: 'lead',
      resourceId: null,
      createdAt: now,
      metadata: {
        format,
        rowCount: rows.length,
        total,
        capped,
        sortBy: input.sortBy ?? 'createdAt',
        sortOrder: input.sortOrder ?? 'desc',
        filters: exportAuditFilters(filterInput),
      },
    });

    return {
      format,
      filename: leadExportFilename(format, jstDate(now)),
      mimeType: LEAD_EXPORT_MIME_TYPES[format],
      encoding: format === 'pdf' ? ('base64' as const) : ('utf8' as const),
      content,
      rowCount: rows.length,
      total,
      capped,
      maxRows: LEAD_EXPORT_MAX_ROWS,
    };
  }),

  /**
   * Dashboard card 今週の商談予定 (#137): leads whose latest hearing's next meeting date is in
   * the current Japan week, earliest first, with the assignee and the deal rating
   */
  weekMeetings: organizationProcedure.query(async ({ ctx, input }) => {
    if (!ctx.ability.can('read', 'Lead')) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'リードを閲覧する権限がありません',
      });
    }
    return getWeekMeetings(ctx.db, input.organizationId);
  }),

  /** Dashboard KPI 初回商談から次回日程が決まった率 for the period (#137, see meetings.ts) */
  nextMeetingRate: organizationProcedure
    .input(
      z.object({
        organizationId: z.string().uuid(),
        days: z.union([z.literal(7), z.literal(30), z.literal(90)]),
      })
    )
    .query(async ({ ctx, input }) => {
      if (!ctx.ability.can('read', 'Lead')) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'リードを閲覧する権限がありません',
        });
      }
      return getNextMeetingRate(ctx.db, input.organizationId, input.days);
    }),

  /**
   * Figures of the list page's cards for the whole organization (#131): leads per status. Not
   * affected by the list filters. No average score: the MQL level is the sign (#447).
   */
  statusCounts: organizationProcedure.query(async ({ ctx, input }) => {
    if (!ctx.ability.can('read', 'Lead')) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'リードを閲覧する権限がありません',
      });
    }

    const rows = await ctx.db
      .select({
        status: leads.status,
        count: count(),
      })
      .from(leads)
      .where(eq(leads.organizationId, input.organizationId))
      .groupBy(leads.status);

    const byStatus = Object.fromEntries(LEAD_STATUSES.map((status) => [status, 0])) as Record<
      LeadStatus,
      number
    >;
    let total = 0;
    for (const row of rows) {
      const n = Number(row.count);
      total += n;
      // Values outside the pipeline (old data) count in the total only
      if ((LEAD_STATUSES as readonly string[]).includes(row.status)) {
        byStatus[row.status as LeadStatus] += n;
      }
    }

    return {
      total,
      byStatus,
    };
  }),

  /**
   * Update a lead
   */
  update: organizationProcedure.input(updateLeadSchema).mutation(async ({ ctx, input }) => {
    // Check permission
    if (!ctx.ability.can('update', 'Lead')) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'リードを更新する権限がありません',
      });
    }

    const now = new Date();
    const leadScope = and(eq(leads.id, input.id), eq(leads.organizationId, input.organizationId));

    // The update and its audit row are written together; the row lock keeps the audited
    // "before" equal to the values this update replaces (Refs #101)
    const result = await ctx.db.transaction(async (tx) => {
      await tx.execute(sql`select 1 from ${leads} where ${leadScope} for no key update`);

      // Verify lead exists and belongs to organization
      const existing = await tx.query.leads.findFirst({ where: leadScope });

      if (!existing) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'リードが見つかりません',
        });
      }
      if (makesLostOnHold(existing, input)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: LOST_ON_HOLD_MESSAGE });
      }

      // Build update object (only include defined fields)
      const updateData: PgUpdateSetSource<typeof leads> = {};
      if (input.email !== undefined) updateData.email = input.email;
      if (input.name !== undefined) updateData.name = input.name;
      if (input.company !== undefined) updateData.company = input.company;
      if (input.phone !== undefined) updateData.phone = input.phone;
      if (input.status !== undefined) {
        Object.assign(updateData, statusUpdateFields(input.status));
      }
      if (input.score !== undefined) updateData.score = input.score;
      if (input.source !== undefined) updateData.source = input.source;
      if (input.responses !== undefined) updateData.responses = input.responses;
      Object.assign(updateData, pickPipelineFields(input));
      if (dropsOnHoldReason(existing, input)) updateData.lostReason = null;
      Object.assign(updateData, qualificationUpdateFields(input, existing, now));
      if (input.dealPhase) {
        // First date each phase was reached; the existing date wins (right side of ||), and
        // merging in SQL keeps concurrent updates from dropping each other's dates (#83)
        updateData.dealPhaseReachedAt = sql`jsonb_build_object(${input.dealPhase}::text, ${jstDate(now)}::text) || coalesce(${leads.dealPhaseReachedAt}, '{}'::jsonb)`;
      }
      updateData.updatedAt = now;

      // Update lead
      const [updated] = await tx.update(leads).set(updateData).where(leadScope).returning();

      // Only the fields whose value actually changed; no row when nothing changed
      const changes = updated
        ? diffLeadAudit(leadAuditSnapshot(existing), leadAuditSnapshot(updated))
        : null;
      if (changes) {
        await writeLeadAuditLogs(
          tx,
          { organizationId: input.organizationId, userId: ctx.user.id, at: now },
          [{ action: 'update', leadId: input.id, changes }]
        );
      }

      return {
        existing,
        updated,
        handedOff: !!updated && isFirstHandoff(existing, updated.dealPhaseReachedAt),
      };
    });
    if (result.updated) {
      emitLeadEvents(input.organizationId, leadChangeEvents(result.existing, result.updated), {
        database: ctx.db,
      });
    }

    // Moved on from the initial hearing: the handoff sheet goes to the technical team (#86)
    if (result.handedOff) {
      await notifyLeadHandoff(ctx.db, {
        organizationId: input.organizationId,
        leadId: input.id,
        userId: ctx.user.id,
      });
    }
    return result.updated;
  }),

  /**
   * Members a lead can be assigned to (#135). Read-only roles can read the list too: they see
   * the names, not the controls.
   */
  assignees: organizationProcedure.query(async ({ ctx, input }) => {
    if (!ctx.ability.can('read', 'Lead')) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'リードを閲覧する権限がありません',
      });
    }
    const members = await listAssignableMembers(ctx.db, input.organizationId);
    return members.map((member) => ({
      userId: member.userId,
      name: member.name,
      email: member.email,
      displayName: memberDisplayName(member),
    }));
  }),

  /**
   * Assign a lead to a member of its organization, or to nobody (#135). The change is written
   * to the audit log with the lead update; the new assignee is told in-app and by email
   * (not when assigning oneself).
   */
  assign: organizationProcedure.input(assignLeadSchema).mutation(async ({ ctx, input }) => {
    if (!ctx.ability.can('update', 'Lead')) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'リードを更新する権限がありません',
      });
    }

    const now = new Date();
    const leadScope = and(eq(leads.id, input.id), eq(leads.organizationId, input.organizationId));

    const result = await ctx.db.transaction(async (tx) => {
      await tx.execute(sql`select 1 from ${leads} where ${leadScope} for no key update`);
      const existing = await tx.query.leads.findFirst({ where: leadScope });
      if (!existing) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'リードが見つかりません',
        });
      }

      // Only members of the lead's own organization (never another organization's users)
      const assignee = input.assigneeUserId
        ? await findAssignableMember(tx, input.organizationId, input.assigneeUserId)
        : null;
      if (input.assigneeUserId && !assignee) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'この組織で担当にできるメンバーではありません',
        });
      }

      const beforeId = existing.assigneeUserId ?? null;
      const afterId = assignee?.userId ?? null;
      if (beforeId === afterId) return { lead: existing, assignee, changed: false };

      const [updated] = await tx
        .update(leads)
        .set({ assigneeUserId: afterId, updatedAt: now })
        .where(leadScope)
        .returning();

      await writeLeadAuditLogs(
        tx,
        { organizationId: input.organizationId, userId: ctx.user.id, at: now },
        [
          {
            action: 'update',
            leadId: input.id,
            changes: {
              before: { assignee: beforeId ? await findUserName(tx, beforeId) : null },
              after: { assignee: assignee ? memberDisplayName(assignee) : null },
            },
            metadata: { assigneeUserId: { before: beforeId, after: afterId } },
          },
        ]
      );
      return { lead: updated ?? existing, assignee, changed: true };
    });

    if (result.changed && result.assignee && result.assignee.userId !== ctx.user.id) {
      // After the commit; a failed notification never undoes the assignment
      await notifyLeadAssigned({
        organizationId: input.organizationId,
        leadId: input.id,
        leadName: result.lead.name ?? null,
        company: result.lead.company ?? null,
        assignee: result.assignee,
        assignedByName: ctx.user.name ?? ctx.user.email ?? null,
      }).catch((error) => console.error('Lead assignment notification failed:', error));
    }

    return result.lead;
  }),

  /**
   * Intake members (窓口) of the organization: consultation requests are mailed to them (#135).
   * `canEdit` tells the settings screen whether to show the controls.
   */
  intake: organizationProcedure.query(async ({ ctx, input }) => {
    if (!ctx.ability.can('read', 'Lead')) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'リードを閲覧する権限がありません',
      });
    }
    const members = await listIntakeMembers(ctx.db, input.organizationId);
    return {
      userIds: members.map((member) => member.userId),
      canEdit: INTAKE_EDITOR_ROLES.includes(ctx.membership.role),
    };
  }),

  /** Choose the intake members; owners and admins only, members of this organization only */
  setIntake: organizationProcedure.input(setLeadIntakeSchema).mutation(async ({ ctx, input }) => {
    if (!INTAKE_EDITOR_ROLES.includes(ctx.membership.role)) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: '窓口の設定は管理者またはオーナーのみ可能です',
      });
    }
    const userIds = [...new Set(input.userIds)];
    const members = await listAssignableMembers(ctx.db, input.organizationId);
    const memberIds = new Set(members.map((member) => member.userId));
    if (userIds.some((id) => !memberIds.has(id))) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'この組織で窓口にできるメンバーではありません',
      });
    }
    const before = await getIntakeUserIds(ctx.db, input.organizationId);
    await setIntakeUserIds(ctx.db, input.organizationId, userIds);
    await ctx.db.insert(auditLogs).values({
      organizationId: input.organizationId,
      userId: ctx.user.id,
      action: 'update',
      resource: 'organization',
      resourceId: input.organizationId,
      changes: { before: { leadIntakeUserIds: before }, after: { leadIntakeUserIds: userIds } },
    });
    return { userIds };
  }),

  /**
   * Delete a lead
   */
  delete: organizationProcedure.input(deleteLeadSchema).mutation(async ({ ctx, input }) => {
    // Check permission
    if (!ctx.ability.can('delete', 'Lead')) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'リードを削除する権限がありません',
      });
    }

    const leadScope = and(eq(leads.id, input.id), eq(leads.organizationId, input.organizationId));
    let deletedAt: Date | null = null;

    const result = await ctx.db.transaction(async (tx) => {
      // Verify lead exists and belongs to organization
      const existing = await tx.query.leads.findFirst({ where: leadScope });

      if (!existing) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'リードが見つかりません',
        });
      }

      // Delete lead (the audit row keeps only the name and company)
      await tx.delete(leads).where(leadScope);
      deletedAt = new Date();
      await writeLeadAuditLogs(
        tx,
        { organizationId: input.organizationId, userId: ctx.user.id, at: new Date() },
        [
          {
            action: 'delete',
            leadId: existing.id,
            before: { name: existing.name ?? null, company: existing.company ?? null },
          },
        ]
      );

      return { success: true };
    });
    if (deletedAt) {
      emitLeadEvents(
        input.organizationId,
        [{ type: 'lead.deleted', leadId: input.id, deletedAt }],
        { database: ctx.db }
      );
    }
    return result;
  }),

  /**
   * Bulk update status for multiple leads
   */
  bulkUpdateStatus: organizationProcedure
    .input(bulkUpdateStatusSchema)
    .mutation(async ({ ctx, input }) => {
      // Check permission
      if (!ctx.ability.can('update', 'Lead')) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'リードを更新する権限がありません',
        });
      }

      const now = new Date();
      const scope = and(
        inArray(leads.id, input.ids),
        eq(leads.organizationId, input.organizationId)
      );

      const outcome = await ctx.db.transaction(async (tx) => {
        // Lock the rows so the audited "before" is the status this update replaces
        await tx.execute(sql`select 1 from ${leads} where ${scope} for no key update`);
        const before = await tx.query.leads.findMany({
          columns: { id: true, status: true, lostReason: true },
          where: scope,
        });

        // Update all leads matching the IDs and organization
        const result = await tx
          .update(leads)
          .set({
            ...statusUpdateFields(input.status),
            // Leads on hold that are now lost drop the reason 保留 (#445)
            ...(input.status === 'lost'
              ? {
                  lostReason: sql`case when ${leads.status} <> 'lost' and ${leads.lostReason} = 'on_hold' then null else ${leads.lostReason} end`,
                }
              : {}),
            updatedAt: now,
          })
          .where(scope)
          .returning();

        // One audit row per lead whose status actually changed (Refs #101)
        const updatedIds = new Set(result.map((row) => row.id));
        await writeLeadAuditLogs(
          tx,
          { organizationId: input.organizationId, userId: ctx.user.id, at: now },
          before
            .filter((row) => updatedIds.has(row.id) && row.status !== input.status)
            .map((row) =>
              dropsOnHoldReason(row, { status: input.status })
                ? {
                    action: 'update' as const,
                    leadId: row.id,
                    changes: {
                      before: { status: row.status, lostReason: row.lostReason },
                      after: { status: input.status, lostReason: null },
                    },
                  }
                : {
                    action: 'update' as const,
                    leadId: row.id,
                    changes: { before: { status: row.status }, after: { status: input.status } },
                  }
            )
        );

        const previousStatus = new Map(before.map((row) => [row.id, row.status]));
        const events: LeadEvent[] = [];
        for (const lead of result) {
          const previous = previousStatus.get(lead.id);
          if (previous !== undefined && previous !== lead.status) {
            events.push({ type: 'lead.status_changed', lead, previousStatus: previous });
          }
        }
        return { response: { success: true, updatedCount: result.length }, events };
      });
      emitLeadEvents(input.organizationId, outcome.events, { database: ctx.db });
      return outcome.response;
    }),

  /**
   * Bulk delete multiple leads
   */
  bulkDelete: organizationProcedure.input(bulkDeleteSchema).mutation(async ({ ctx, input }) => {
    // Check permission
    if (!ctx.ability.can('delete', 'Lead')) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'リードを削除する権限がありません',
      });
    }

    const deleted = await ctx.db.transaction(async (tx) => {
      // Delete all leads matching the IDs and organization
      const result = await tx
        .delete(leads)
        .where(and(inArray(leads.id, input.ids), eq(leads.organizationId, input.organizationId)))
        .returning({ id: leads.id, name: leads.name, company: leads.company });

      await writeLeadAuditLogs(
        tx,
        { organizationId: input.organizationId, userId: ctx.user.id, at: new Date() },
        result.map((row) => ({
          action: 'delete' as const,
          leadId: row.id,
          before: { name: row.name ?? null, company: row.company ?? null },
        }))
      );

      return result;
    });
    const deletedAt = new Date();
    emitLeadEvents(
      input.organizationId,
      deleted.map((row) => ({ type: 'lead.deleted' as const, leadId: row.id, deletedAt })),
      { database: ctx.db }
    );
    return {
      success: true,
      deletedCount: deleted.length,
    };
  }),

  /**
   * Bulk create leads from import
   */
  bulkCreate: organizationProcedure.input(bulkCreateSchema).mutation(async ({ ctx, input }) => {
    // Check permission
    if (!ctx.ability.can('create', 'Lead')) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'リードを作成する権限がありません',
      });
    }

    // Insert all leads
    const leadsToInsert = input.leads.map((lead) => ({
      organizationId: input.organizationId,
      email: lead.email,
      name: lead.name,
      company: lead.company,
      phone: lead.phone,
      ...statusUpdateFields(lead.status),
      source: lead.source,
      score: lead.score,
    }));

    const created = await ctx.db.transaction(async (tx) => {
      const result = await tx.insert(leads).values(leadsToInsert).returning();

      await writeLeadAuditLogs(
        tx,
        { organizationId: input.organizationId, userId: ctx.user.id, at: new Date() },
        result.map((lead) => ({
          action: 'create' as const,
          leadId: lead.id,
          after: creationAuditValues(lead),
          metadata: { via: 'import' },
        }))
      );

      return result;
    });
    emitLeadEvents(
      input.organizationId,
      created.map((lead) => ({ type: 'lead.created' as const, lead })),
      { database: ctx.db }
    );
    return {
      success: true,
      createdCount: created.length,
    };
  }),
});
