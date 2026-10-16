import { leadTags, leads, tags } from '@/lib/db/schema';
import { organizationProcedure, router } from '@/lib/trpc/init';
import { TRPCError } from '@trpc/server';
import {
  type SQL,
  and,
  asc,
  between,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  notIlike,
  notInArray,
  or,
  sql,
} from 'drizzle-orm';
import {
  creationAuditValues,
  diffLeadAudit,
  leadAuditSnapshot,
  writeLeadAuditLogs,
} from '../audit';
import {
  type LeadPipelineFields,
  jstDate,
  qualificationUpdateFields,
  statusUpdateFields,
} from '../types/pipeline';
import {
  type FilterCondition,
  type FilterGroup,
  bulkCreateSchema,
  bulkDeleteSchema,
  bulkUpdateStatusSchema,
  createLeadSchema,
  deleteLeadSchema,
  getLeadSchema,
  listLeadsSchema,
  updateLeadSchema,
} from '../types/schemas';

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

/**
 * Build SQL condition from a filter condition
 */
function buildCondition(condition: FilterCondition): SQL | undefined {
  const { field, operator, value, value2 } = condition;

  // Map field names to lead columns
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const columnMap: Record<string, any> = {
    name: leads.name,
    email: leads.email,
    company: leads.company,
    phone: leads.phone,
    status: leads.status,
    source: leads.source,
    inflowSource: leads.inflowSource,
    conversionPoint: leads.conversionPoint,
    dealPhase: leads.dealPhase,
    targetSystem: leads.targetSystem,
    lostReason: leads.lostReason,
    referrerName: leads.referrerName,
    agencyName: leads.agencyName,
    acquisitionCost: leads.acquisitionCost,
    score: leads.score,
    createdAt: leads.createdAt,
    updatedAt: leads.updatedAt,
  };

  const column = columnMap[field];
  if (!column) return undefined;

  switch (operator) {
    case 'equals':
      return eq(column, value as string);
    case 'not_equals':
      return ne(column, value as string);
    case 'contains':
      return ilike(column, `%${value}%`);
    case 'not_contains':
      return notIlike(column, `%${value}%`);
    case 'starts_with':
      return ilike(column, `${value}%`);
    case 'ends_with':
      return ilike(column, `%${value}`);
    case 'greater_than':
      return gt(column, value as number | Date);
    case 'less_than':
      return lt(column, value as number | Date);
    case 'greater_or_equal':
      return gte(column, value as number | Date);
    case 'less_or_equal':
      return lte(column, value as number | Date);
    case 'between':
      return between(column, value as number | Date, value2 as number | Date);
    case 'is_empty':
      return or(isNull(column), eq(column, ''));
    case 'is_not_empty':
      return and(isNotNull(column), ne(column, ''));
    case 'in':
      return inArray(column, value as string[]);
    case 'not_in':
      return notInArray(column, value as string[]);
    default:
      return undefined;
  }
}

/**
 * Build SQL conditions from a filter group (recursive)
 */
function buildFilterGroup(group: FilterGroup): SQL | undefined {
  const conditions: (SQL | undefined)[] = [];

  // Build conditions from this group
  for (const condition of group.conditions) {
    const sqlCondition = buildCondition(condition);
    if (sqlCondition) {
      conditions.push(sqlCondition);
    }
  }

  // Build nested groups
  if (group.groups) {
    for (const nestedGroup of group.groups) {
      const nestedCondition = buildFilterGroup(nestedGroup as FilterGroup);
      if (nestedCondition) {
        conditions.push(nestedCondition);
      }
    }
  }

  // Filter out undefined
  const validConditions = conditions.filter((c): c is SQL => c !== undefined);

  if (validConditions.length === 0) return undefined;
  if (validConditions.length === 1) return validConditions[0];

  return group.logic === 'and' ? and(...validConditions) : or(...validConditions);
}

/**
 * Leads tRPC router
 * Handles CRUD operations for leads with multi-tenant isolation
 */
export const leadsRouter = router({
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

    const now = new Date();
    // Create the lead and its audit row together (Refs #101)
    return ctx.db.transaction(async (tx) => {
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
      with: {
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

    // Build where conditions
    const conditions: (SQL | undefined)[] = [eq(leads.organizationId, input.organizationId)];

    // Basic filters
    if (input.inflowSource) {
      conditions.push(eq(leads.inflowSource, input.inflowSource));
    }
    if (input.dealPhase) {
      conditions.push(eq(leads.dealPhase, input.dealPhase));
    }
    if (input.status) {
      conditions.push(eq(leads.status, input.status));
    }

    if (input.source) {
      conditions.push(eq(leads.source, input.source));
    }

    if (input.search) {
      const searchTerm = `%${input.search}%`;
      conditions.push(
        or(
          ilike(leads.name, searchTerm),
          ilike(leads.email, searchTerm),
          ilike(leads.company, searchTerm)
        )!
      );
    }

    // Date range filter
    if (input.createdFrom) {
      conditions.push(gte(leads.createdAt, new Date(input.createdFrom)));
    }

    if (input.createdTo) {
      conditions.push(lte(leads.createdAt, new Date(input.createdTo)));
    }

    // Score range filter
    if (input.scoreMin !== undefined) {
      conditions.push(gte(leads.score, input.scoreMin));
    }

    if (input.scoreMax !== undefined) {
      conditions.push(lte(leads.score, input.scoreMax));
    }

    // Tag filter - get lead IDs that have the specified tags
    if (input.tagIds && input.tagIds.length > 0) {
      const leadsWithTags = await ctx.db
        .select({ leadId: leadTags.leadId })
        .from(leadTags)
        .where(inArray(leadTags.tagId, input.tagIds))
        .groupBy(leadTags.leadId);

      if (leadsWithTags.length > 0) {
        conditions.push(
          inArray(
            leads.id,
            leadsWithTags.map((lt) => lt.leadId)
          )
        );
      } else {
        // No leads match the tag filter
        return {
          items: [],
          total: 0,
          limit: input.limit,
          offset: input.offset,
        };
      }
    }

    // Advanced filter
    if (input.advancedFilter) {
      const advancedCondition = buildFilterGroup(input.advancedFilter);
      if (advancedCondition) {
        conditions.push(advancedCondition);
      }
    }

    // Build order by
    const sortColumn = input.sortBy || 'createdAt';
    const sortOrder = input.sortOrder || 'desc';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const orderByMap: Record<string, any> = {
      createdAt: leads.createdAt,
      updatedAt: leads.updatedAt,
      name: leads.name,
      email: leads.email,
      score: leads.score,
      status: leads.status,
    };

    const orderColumn = orderByMap[sortColumn] || leads.createdAt;
    const orderDirection = sortOrder === 'asc' ? asc(orderColumn) : desc(orderColumn);

    // Filter out undefined conditions
    const validConditions = conditions.filter((c): c is SQL => c !== undefined);

    // Get total count
    const totalCount = await ctx.db
      .select({ count: leads.id })
      .from(leads)
      .where(and(...validConditions));

    // Get paginated results with tags
    const results = await ctx.db.query.leads.findMany({
      where: and(...validConditions),
      orderBy: [orderDirection],
      limit: input.limit,
      offset: input.offset,
      with: {
        leadTags: {
          with: {
            tag: true,
          },
        },
      },
    });

    // Transform results to include tags array
    const itemsWithTags = results.map((lead) => ({
      ...lead,
      tags: lead.leadTags.map((lt) => lt.tag),
    }));

    return {
      items: itemsWithTags,
      total: totalCount.length,
      limit: input.limit,
      offset: input.offset,
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
    return ctx.db.transaction(async (tx) => {
      await tx.execute(sql`select 1 from ${leads} where ${leadScope} for no key update`);

      // Verify lead exists and belongs to organization
      const existing = await tx.query.leads.findFirst({ where: leadScope });

      if (!existing) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'リードが見つかりません',
        });
      }

      // Build update object (only include defined fields)
      const updateData: any = {};
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

      return updated;
    });
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

    return ctx.db.transaction(async (tx) => {
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

      return ctx.db.transaction(async (tx) => {
        // Lock the rows so the audited "before" is the status this update replaces
        await tx.execute(sql`select 1 from ${leads} where ${scope} for no key update`);
        const before = await tx.query.leads.findMany({
          columns: { id: true, status: true },
          where: scope,
        });

        // Update all leads matching the IDs and organization
        const result = await tx
          .update(leads)
          .set({
            ...statusUpdateFields(input.status),
            updatedAt: now,
          })
          .where(scope)
          .returning({ id: leads.id });

        // One audit row per lead whose status actually changed (Refs #101)
        const updatedIds = new Set(result.map((row) => row.id));
        await writeLeadAuditLogs(
          tx,
          { organizationId: input.organizationId, userId: ctx.user.id, at: now },
          before
            .filter((row) => updatedIds.has(row.id) && row.status !== input.status)
            .map((row) => ({
              action: 'update' as const,
              leadId: row.id,
              changes: { before: { status: row.status }, after: { status: input.status } },
            }))
        );

        return {
          success: true,
          updatedCount: result.length,
        };
      });
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

    return ctx.db.transaction(async (tx) => {
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

      return {
        success: true,
        deletedCount: result.length,
      };
    });
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

    return ctx.db.transaction(async (tx) => {
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

      return {
        success: true,
        createdCount: result.length,
      };
    });
  }),
});
