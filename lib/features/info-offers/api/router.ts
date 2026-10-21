/**
 * Info Offers tRPC Router (Refs #153)
 *
 * Anyone who can read leads may see the offers and a lead's requests; changing the offers needs
 * permission to update settings (owner / admin); recording attendance needs permission to update
 * leads (not viewers from a parent organization).
 */

import type { AppAbility } from '@/lib/auth/permissions';
import { jstDate } from '@/lib/features/leads/types/pipeline';
import { organizationProcedure, router } from '@/lib/trpc/init';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import {
  countSeminarRequests,
  getInfoOffers,
  listLeadOfferRequests,
  saveInfoOffers,
  setSeminarAttendance,
} from '../service';
import { leadScopeSchema, setAttendanceSchema, updateInfoOffersSchema } from '../types/schemas';

type Ctx = { ability: AppAbility; membership: { role: string } };

function assertCanRead(ctx: Ctx) {
  if (!ctx.ability.can('read', 'Lead')) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not have permission to read leads' });
  }
}

const canRecordAttendance = (ctx: Ctx) =>
  ctx.ability.can('update', 'Lead') && ctx.membership.role !== 'parent_viewer';

export const infoOffersRouter = router({
  settings: organizationProcedure
    .input(z.object({ organizationId: z.string().uuid() }))
    .query(async ({ ctx }) => {
      assertCanRead(ctx);
      const [settings, seminarCounts] = await Promise.all([
        getInfoOffers(ctx.db, ctx.organization.id),
        countSeminarRequests(ctx.db, ctx.organization.id, jstDate()),
      ]);
      return { settings, seminarCounts, canEdit: ctx.ability.can('update', 'Settings') };
    }),

  updateSettings: organizationProcedure
    .input(updateInfoOffersSchema)
    .mutation(async ({ ctx, input }) => {
      if (!ctx.ability.can('update', 'Settings')) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You do not have permission to change the settings',
        });
      }
      await saveInfoOffers(ctx.db, ctx.organization.id, input.settings);
      return { ok: true };
    }),

  leadRequests: organizationProcedure.input(leadScopeSchema).query(async ({ ctx, input }) => {
    assertCanRead(ctx);
    const items = await listLeadOfferRequests(ctx.db, {
      organizationId: ctx.organization.id,
      leadId: input.leadId,
    });
    if (!items) throw new TRPCError({ code: 'NOT_FOUND', message: 'Lead not found' });
    return { items, canRecordAttendance: canRecordAttendance(ctx) };
  }),

  setAttendance: organizationProcedure
    .input(setAttendanceSchema)
    .mutation(async ({ ctx, input }) => {
      if (!canRecordAttendance(ctx)) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You do not have permission to record attendance',
        });
      }
      const found = await setSeminarAttendance(ctx.db, {
        organizationId: ctx.organization.id,
        id: input.id,
        attended: input.attended,
        userId: ctx.user.id,
      });
      if (!found) throw new TRPCError({ code: 'NOT_FOUND', message: 'Seminar request not found' });
      return { ok: true };
    }),
});
