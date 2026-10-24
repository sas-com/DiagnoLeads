/**
 * Lead follow-up tRPC router: contact records (Refs #136) and next actions (Refs #85)
 *
 * Anyone who can read leads may read (including viewers from a parent organization);
 * recording, changing and deleting need permission to update leads. Every query is scoped by
 * organizationId (see ../service.ts).
 */

import type { AppAbility } from '@/lib/auth/permissions';
import { jstDate } from '@/lib/features/leads/types/pipeline';
import { organizationProcedure, router } from '@/lib/trpc/init';
import { TRPCError } from '@trpc/server';
import {
  createTask,
  deleteContact,
  deleteTask,
  getContactSummary,
  listDueTasks,
  listTasks,
  recordContact,
  updateTask,
} from '../service';
import {
  createTaskSchema,
  deleteContactSchema,
  deleteTaskSchema,
  dueTasksSchema,
  leadScopeSchema,
  recordContactSchema,
  updateTaskSchema,
} from '../types/schemas';

function assertCanRead(ability: AppAbility) {
  if (!ability.can('read', 'Lead')) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'You do not have permission to read the follow-up of leads',
    });
  }
}

function assertCanWrite(ability: AppAbility) {
  if (!ability.can('update', 'Lead')) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'You do not have permission to change the follow-up of leads',
    });
  }
}

export const leadFollowUpRouter = router({
  /** First contact time and the latest contact records of a lead */
  contacts: organizationProcedure.input(leadScopeSchema).query(async ({ ctx, input }) => {
    assertCanRead(ctx.ability);
    const summary = await getContactSummary(ctx.db, {
      organizationId: ctx.organization.id,
      leadId: input.leadId,
    });
    return { ...summary, canEdit: ctx.ability.can('update', 'Lead') };
  }),

  /** One tap: "called", "emailed" or "could not reach", now */
  recordContact: organizationProcedure
    .input(recordContactSchema)
    .mutation(async ({ ctx, input }) => {
      assertCanWrite(ctx.ability);
      return recordContact(ctx.db, {
        ...input,
        organizationId: ctx.organization.id,
        userId: ctx.user.id,
      });
    }),

  deleteContact: organizationProcedure
    .input(deleteContactSchema)
    .mutation(async ({ ctx, input }) => {
      assertCanWrite(ctx.ability);
      return deleteContact(ctx.db, {
        organizationId: ctx.organization.id,
        id: input.id,
        userId: ctx.user.id,
      });
    }),

  /** Next actions of a lead */
  tasks: organizationProcedure.input(leadScopeSchema).query(async ({ ctx, input }) => {
    assertCanRead(ctx.ability);
    const items = await listTasks(ctx.db, {
      organizationId: ctx.organization.id,
      leadId: input.leadId,
    });
    return { items, today: jstDate(), canEdit: ctx.ability.can('update', 'Lead') };
  }),

  /**
   * Open next actions and takeaways due today or earlier, for the dashboard: the user's own
   * (scope 'mine', the default) or everyone's with the user's own first ('all'). The first
   * DUE_TASKS_SHOWN, or `limit` when the card is opened to show the rest (#431)
   */
  dueTasks: organizationProcedure.input(dueTasksSchema).query(async ({ ctx, input }) => {
    assertCanRead(ctx.ability);
    const today = jstDate();
    const due = await listDueTasks(ctx.db, {
      organizationId: ctx.organization.id,
      today,
      userId: ctx.user.id,
      scope: input.scope,
      limit: input.limit,
    });
    return { ...due, scope: input.scope, today, canEdit: ctx.ability.can('update', 'Lead') };
  }),

  createTask: organizationProcedure.input(createTaskSchema).mutation(async ({ ctx, input }) => {
    assertCanWrite(ctx.ability);
    return createTask(ctx.db, {
      ...input,
      organizationId: ctx.organization.id,
      userId: ctx.user.id,
    });
  }),

  updateTask: organizationProcedure.input(updateTaskSchema).mutation(async ({ ctx, input }) => {
    assertCanWrite(ctx.ability);
    return updateTask(ctx.db, {
      ...input,
      organizationId: ctx.organization.id,
      userId: ctx.user.id,
    });
  }),

  deleteTask: organizationProcedure.input(deleteTaskSchema).mutation(async ({ ctx, input }) => {
    assertCanWrite(ctx.ability);
    return deleteTask(ctx.db, {
      organizationId: ctx.organization.id,
      id: input.id,
      userId: ctx.user.id,
    });
  }),
});
