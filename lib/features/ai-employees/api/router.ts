/**
 * AI Employees tRPC Router (Refs #1101, Epic #1100)
 *
 * Anyone who can read the analytics may look into the office (the runs hold counts and codes
 * only); hiring, renaming, pausing and dismissing need permission to update the settings. Every
 * query is scoped by organizationId (see ../service.ts).
 */
import { organizationProcedure, router } from '@/lib/trpc/init';
import { TRPCError } from '@trpc/server';
import { advanceSession } from '../agent/runtime';
import {
  copyTemplate,
  getEmployeeTrainings,
  getTemplates,
  saveEmployeeTraining,
  saveTemplate,
} from '../curriculum';
import {
  type TemplateUpdateFailure,
  applyTemplateUpdate,
  getTemplateUpdates,
} from '../curriculum-updates';
import { dismissEmployee, getOffice, hireEmployee, listRuns, updateEmployee } from '../service';
import {
  type TrainingFailure,
  answerOnboarding,
  cancelSession,
  decideReview,
  editNote,
  getTraining,
  setPolicy,
  startOnboarding,
  startReview,
} from '../training';
import {
  applyTemplateUpdateSchema,
  copyTemplateSchema,
  curriculumScopeSchema,
  saveEmployeeTrainingSchema,
  saveTemplateSchema,
} from '../types/curriculum';
import {
  employeeScopeSchema,
  hireAiEmployeeSchema,
  officeScopeSchema,
  updateAiEmployeeSchema,
} from '../types/schemas';
import {
  answerOnboardingSchema,
  decideReviewSchema,
  editMemorySchema,
  sessionScopeSchema,
  setPolicySchema,
  startOnboardingSchema,
  startReviewSchema,
  trainingScopeSchema,
} from '../types/training';

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

/**
 * A refusal of the training room as an error the screen can name: the message is the failure's
 * code (TrainingFailure), never free text
 */
function trainingError(failure: TrainingFailure | TemplateUpdateFailure): TRPCError {
  const code =
    failure === 'not_found'
      ? 'NOT_FOUND'
      : failure === 'agent_disabled'
        ? 'PRECONDITION_FAILED'
        : failure === 'invalid_note'
          ? 'BAD_REQUEST'
          : 'CONFLICT';
  return new TRPCError({ code, message: failure });
}

function unwrap<T>(result: { ok: true; value: T } | { ok: false; failure: TrainingFailure }): T {
  if (!result.ok) throw trainingError(result.failure);
  return result.value;
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

  /**
   * The training room (Epic #1187). Anyone who may look into the office sees the grades and the
   * reviews' counts; the notes, the reports and the policy are for the managers only, like the
   * actions that follow
   */
  training: organizationProcedure.input(trainingScopeSchema).query(async ({ ctx }) => {
    assertCanRead(ctx.ability.can('read', 'Analytics'));
    const canManage = ctx.ability.can('update', 'Settings');
    const training = await getTraining(ctx.db, { organizationId: ctx.organization.id });
    return {
      agentEnabled: training.agentEnabled,
      canManage,
      employees: canManage
        ? training.employees
        : training.employees.map((employee) => ({
            ...employee,
            policy: '',
            notes: [],
            session: employee.session && { ...employee.session, report: null },
            refresher: employee.refresher && { ...employee.refresher, report: null },
          })),
    };
  }),

  /**
   * The training of the AI employees (#1280): the organization's templates and each employee's
   * own copy. What the company teaches is for the managers only, like the policy
   */
  curriculum: organizationProcedure.input(curriculumScopeSchema).query(async ({ ctx, input }) => {
    assertCanManage(ctx.ability.can('update', 'Settings'));
    const [templates, trainings, updates] = await Promise.all([
      getTemplates(ctx.db, { organizationId: ctx.organization.id, locale: input.locale }),
      getEmployeeTrainings(ctx.db, { organizationId: ctx.organization.id }),
      getTemplateUpdates(ctx.db, { organizationId: ctx.organization.id }),
    ]);
    return { templates, employees: Object.fromEntries(trainings), updates };
  }),

  /**
   * Brings a newer template into an employee's training (#1281): the chosen sections are
   * replaced, and a refresher may follow
   */
  applyTemplateUpdate: organizationProcedure
    .input(applyTemplateUpdateSchema)
    .mutation(async ({ ctx, input }) => {
      assertCanManage(ctx.ability.can('update', 'Settings'));
      const result = await applyTemplateUpdate(ctx.db, {
        organizationId: ctx.organization.id,
        employeeId: input.employeeId,
        kind: input.kind,
        fromVersion: input.fromVersion,
        toVersion: input.toVersion,
        replace: input.replace,
        refresher: input.refresher,
        locale: input.locale,
        userId: ctx.user.id,
      });
      if (!result.ok) throw trainingError(result.failure);
      return result.value;
    }),

  saveTemplate: organizationProcedure.input(saveTemplateSchema).mutation(async ({ ctx, input }) => {
    assertCanManage(ctx.ability.can('update', 'Settings'));
    return saveTemplate(ctx.db, {
      organizationId: ctx.organization.id,
      scope: input.scope,
      sections: input.sections,
      userId: ctx.user.id,
    });
  }),

  saveTraining: organizationProcedure
    .input(saveEmployeeTrainingSchema)
    .mutation(async ({ ctx, input }) => {
      assertCanManage(ctx.ability.can('update', 'Settings'));
      const saved = await saveEmployeeTraining(ctx.db, {
        organizationId: ctx.organization.id,
        employeeId: input.employeeId,
        kind: input.kind,
        sections: input.sections,
        userId: ctx.user.id,
      });
      if (!saved) throw notFound();
      return saved;
    }),

  copyTemplate: organizationProcedure.input(copyTemplateSchema).mutation(async ({ ctx, input }) => {
    assertCanManage(ctx.ability.can('update', 'Settings'));
    const copied = await copyTemplate(ctx.db, {
      organizationId: ctx.organization.id,
      employeeId: input.employeeId,
      kind: input.kind,
      locale: input.locale,
      userId: ctx.user.id,
    });
    if (!copied) throw notFound();
    return copied;
  }),

  setPolicy: organizationProcedure.input(setPolicySchema).mutation(async ({ ctx, input }) => {
    assertCanManage(ctx.ability.can('update', 'Settings'));
    return unwrap(
      await setPolicy(ctx.db, {
        organizationId: ctx.organization.id,
        employeeId: input.employeeId,
        policy: input.policy,
        userId: ctx.user.id,
      })
    );
  }),

  startOnboarding: organizationProcedure
    .input(startOnboardingSchema)
    .mutation(async ({ ctx, input }) => {
      assertCanManage(ctx.ability.can('update', 'Settings'));
      return unwrap(
        await startOnboarding(ctx.db, {
          organizationId: ctx.organization.id,
          organizationName: ctx.organization.name,
          employeeId: input.employeeId,
          userId: ctx.user.id,
          locale: input.locale,
        })
      );
    }),

  /** One step of a running session: the screen asks again while it says `running` */
  advance: organizationProcedure.input(sessionScopeSchema).mutation(async ({ ctx, input }) => {
    assertCanManage(ctx.ability.can('update', 'Settings'));
    const outcome = await advanceSession(ctx.db, {
      organizationId: ctx.organization.id,
      sessionId: input.sessionId,
      userId: ctx.user.id,
    });
    if (!outcome) throw trainingError('not_found');
    return outcome;
  }),

  answerOnboarding: organizationProcedure
    .input(answerOnboardingSchema)
    .mutation(async ({ ctx, input }) => {
      assertCanManage(ctx.ability.can('update', 'Settings'));
      return unwrap(
        await answerOnboarding(ctx.db, {
          organizationId: ctx.organization.id,
          sessionId: input.sessionId,
          userId: ctx.user.id,
          answer: input.answer,
          correction: input.answer === 'correct' ? input.correction : undefined,
        })
      );
    }),

  cancelSession: organizationProcedure
    .input(sessionScopeSchema)
    .mutation(async ({ ctx, input }) => {
      assertCanManage(ctx.ability.can('update', 'Settings'));
      return unwrap(
        await cancelSession(ctx.db, {
          organizationId: ctx.organization.id,
          sessionId: input.sessionId,
        })
      );
    }),

  startReview: organizationProcedure.input(startReviewSchema).mutation(async ({ ctx, input }) => {
    assertCanManage(ctx.ability.can('update', 'Settings'));
    return unwrap(
      await startReview(ctx.db, {
        organizationId: ctx.organization.id,
        employeeId: input.employeeId,
        userId: ctx.user.id,
        locale: input.locale,
      })
    );
  }),

  decideReview: organizationProcedure.input(decideReviewSchema).mutation(async ({ ctx, input }) => {
    assertCanManage(ctx.ability.can('update', 'Settings'));
    return unwrap(
      await decideReview(ctx.db, {
        organizationId: ctx.organization.id,
        reviewId: input.reviewId,
        userId: ctx.user.id,
        decision: input.decision,
        fromLevel: input.decision === 'promote' ? input.fromLevel : undefined,
      })
    );
  }),

  editNote: organizationProcedure.input(editMemorySchema).mutation(async ({ ctx, input }) => {
    assertCanManage(ctx.ability.can('update', 'Settings'));
    return unwrap(
      await editNote(ctx.db, {
        organizationId: ctx.organization.id,
        employeeId: input.employeeId,
        path: input.path,
        content: input.content,
        userId: ctx.user.id,
      })
    );
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
