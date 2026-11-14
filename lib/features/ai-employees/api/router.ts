/**
 * AI Employees tRPC Router (Refs #1101, Epic #1100)
 *
 * Anyone who can read the analytics may look into the office (the runs hold counts and codes
 * only); hiring, renaming, pausing and dismissing need permission to update the settings. Every
 * query is scoped by organizationId (see ../service.ts).
 */
import { organizationProcedure, router } from '@/lib/trpc/init';
import { TRPCError } from '@trpc/server';
import { dismissEmployee, getOffice, hireEmployee, listRuns, updateEmployee } from '../service';
import {
  employeeScopeSchema,
  hireAiEmployeeSchema,
  officeScopeSchema,
  updateAiEmployeeSchema,
} from '../types/schemas';

const notFound = () => new TRPCError({ code: 'NOT_FOUND', message: 'AI employee not found' });

function assertCanRead(can: boolean) {
  if (!can) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'You do not have permission to view the AI employees',
    });
  }
}

function assertCanManage(can: boolean) {
  if (!can) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'You do not have permission to manage the AI employees',
    });
  }
}

export const aiEmployeesRouter = router({
  office: organizationProcedure.input(officeScopeSchema).query(async ({ ctx }) => {
    assertCanRead(ctx.ability.can('read', 'Analytics'));
    const employees = await getOffice(ctx.db, { organizationId: ctx.organization.id });
    return { employees, canManage: ctx.ability.can('update', 'Settings') };
  }),

  runs: organizationProcedure.input(employeeScopeSchema).query(async ({ ctx, input }) => {
    assertCanRead(ctx.ability.can('read', 'Analytics'));
    const runs = await listRuns(ctx.db, {
      organizationId: ctx.organization.id,
      employeeId: input.employeeId,
    });
    if (!runs) throw notFound();
    return runs;
  }),

  hire: organizationProcedure.input(hireAiEmployeeSchema).mutation(async ({ ctx, input }) => {
    assertCanManage(ctx.ability.can('update', 'Settings'));
    const hired = await hireEmployee(ctx.db, {
      organizationId: ctx.organization.id,
      role: input.role,
      name: input.name,
      userId: ctx.user.id,
    });
    if (!hired) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'An AI employee already has this role',
      });
    }
    return hired;
  }),

  update: organizationProcedure.input(updateAiEmployeeSchema).mutation(async ({ ctx, input }) => {
    assertCanManage(ctx.ability.can('update', 'Settings'));
    if (input.name === undefined && input.status === undefined && input.profile === undefined) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Nothing to update' });
    }
    const updated = await updateEmployee(ctx.db, {
      organizationId: ctx.organization.id,
      employeeId: input.employeeId,
      name: input.name,
      status: input.status,
      profile: input.profile,
    });
    if (!updated) throw notFound();
    return updated;
  }),

  dismiss: organizationProcedure.input(employeeScopeSchema).mutation(async ({ ctx, input }) => {
    assertCanManage(ctx.ability.can('update', 'Settings'));
    const dismissed = await dismissEmployee(ctx.db, {
      organizationId: ctx.organization.id,
      employeeId: input.employeeId,
    });
    if (!dismissed) throw notFound();
    return { employeeId: input.employeeId };
  }),
});
