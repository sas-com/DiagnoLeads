/**
 * Diagnoses tRPC Router (diagnosis builder, Refs #114)
 *
 * Permissions use the `Assessment` subject (lib/auth/permissions.ts):
 * - read: list, get, validate (members and parent viewers included)
 * - update: create and save drafts (owner / admin; members cannot)
 * - manage: publish, pause, resume, archive, delete (owner / admin)
 * Every query is scoped by organizationId (see ../service.ts).
 */
import type { AppAbility } from '@/lib/auth/permissions';
import { organizationProcedure, router } from '@/lib/trpc/init';
import { TRPCError } from '@trpc/server';
import {
  changeDiagnosisStatus,
  createDiagnosis,
  deleteDiagnosis,
  getDiagnosis,
  listDiagnoses,
  publishDiagnosis,
  saveDiagnosisDraft,
  validateDiagnosisDraft,
} from '../service';
import {
  createDiagnosisSchema,
  diagnosisByIdSchema,
  listDiagnosesSchema,
  publishDiagnosisSchema,
  saveDiagnosisDraftSchema,
} from '../types/schemas';

type Need = 'read' | 'update' | 'manage';

const MESSAGES: Record<Need, string> = {
  read: 'You do not have permission to read diagnoses',
  update: 'You do not have permission to edit diagnoses',
  manage: 'You do not have permission to publish or remove diagnoses',
};

function assertCan(ability: AppAbility, need: Need) {
  if (!ability.can(need, 'Assessment')) {
    throw new TRPCError({ code: 'FORBIDDEN', message: MESSAGES[need] });
  }
}

const permissionsOf = (ability: AppAbility) => ({
  canEdit: ability.can('update', 'Assessment'),
  canPublish: ability.can('manage', 'Assessment'),
});

export const diagnosesRouter = router({
  list: organizationProcedure.input(listDiagnosesSchema).query(async ({ ctx }) => {
    assertCan(ctx.ability, 'read');
    const items = await listDiagnoses(ctx.db, { organizationId: ctx.organization.id });
    return { items, ...permissionsOf(ctx.ability) };
  }),

  get: organizationProcedure.input(diagnosisByIdSchema).query(async ({ ctx, input }) => {
    assertCan(ctx.ability, 'read');
    const diagnosis = await getDiagnosis(ctx.db, {
      organizationId: ctx.organization.id,
      id: input.id,
    });
    return { ...diagnosis, ...permissionsOf(ctx.ability) };
  }),

  /** The draft's errors (publishing is refused) and warnings */
  validate: organizationProcedure.input(diagnosisByIdSchema).query(async ({ ctx, input }) => {
    assertCan(ctx.ability, 'read');
    return validateDiagnosisDraft(ctx.db, { organizationId: ctx.organization.id, id: input.id });
  }),

  create: organizationProcedure.input(createDiagnosisSchema).mutation(async ({ ctx, input }) => {
    assertCan(ctx.ability, 'update');
    return createDiagnosis(ctx.db, {
      ...input,
      organizationId: ctx.organization.id,
      userId: ctx.user.id,
    });
  }),

  /** Replace the draft (expectedUpdatedAt guards against lost updates) */
  saveDraft: organizationProcedure
    .input(saveDiagnosisDraftSchema)
    .mutation(async ({ ctx, input }) => {
      assertCan(ctx.ability, 'update');
      return saveDiagnosisDraft(ctx.db, {
        ...input,
        organizationId: ctx.organization.id,
        userId: ctx.user.id,
      });
    }),

  publish: organizationProcedure.input(publishDiagnosisSchema).mutation(async ({ ctx, input }) => {
    assertCan(ctx.ability, 'manage');
    return publishDiagnosis(ctx.db, {
      ...input,
      organizationId: ctx.organization.id,
      userId: ctx.user.id,
    });
  }),

  pause: organizationProcedure.input(diagnosisByIdSchema).mutation(async ({ ctx, input }) => {
    assertCan(ctx.ability, 'manage');
    return changeDiagnosisStatus(ctx.db, {
      organizationId: ctx.organization.id,
      id: input.id,
      userId: ctx.user.id,
      event: 'pause',
    });
  }),

  resume: organizationProcedure.input(diagnosisByIdSchema).mutation(async ({ ctx, input }) => {
    assertCan(ctx.ability, 'manage');
    return changeDiagnosisStatus(ctx.db, {
      organizationId: ctx.organization.id,
      id: input.id,
      userId: ctx.user.id,
      event: 'resume',
    });
  }),

  archive: organizationProcedure.input(diagnosisByIdSchema).mutation(async ({ ctx, input }) => {
    assertCan(ctx.ability, 'manage');
    return changeDiagnosisStatus(ctx.db, {
      organizationId: ctx.organization.id,
      id: input.id,
      userId: ctx.user.id,
      event: 'archive',
    });
  }),

  /** Only a diagnosis that was never published; otherwise archive it */
  delete: organizationProcedure.input(diagnosisByIdSchema).mutation(async ({ ctx, input }) => {
    assertCan(ctx.ability, 'manage');
    return deleteDiagnosis(ctx.db, {
      organizationId: ctx.organization.id,
      id: input.id,
      userId: ctx.user.id,
    });
  }),
});
