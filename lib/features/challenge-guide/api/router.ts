/**
 * Challenge Guide tRPC Router (Refs #75)
 *
 * The card shows the organization's sales playbook, so the same people as the playbook may read
 * it: those who can read leads, except viewers from a parent organization (#74).
 */

import { canReadPlaybook } from '@/lib/features/ax-playbook/access';
import { organizationProcedure, router } from '@/lib/trpc/init';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { getChallengeGuide } from '../service';

export const challengeGuideRouter = router({
  get: organizationProcedure
    .input(z.object({ organizationId: z.string().uuid(), leadId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      if (!canReadPlaybook(ctx)) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You do not have permission to read the sales playbook',
        });
      }
      const guide = await getChallengeGuide(ctx.db, {
        organizationId: ctx.organization.id,
        leadId: input.leadId,
      });
      if (!guide) throw new TRPCError({ code: 'NOT_FOUND', message: 'Lead not found' });
      return { ...guide, canEditPlaybook: ctx.ability.can('update', 'Settings') };
    }),
});
