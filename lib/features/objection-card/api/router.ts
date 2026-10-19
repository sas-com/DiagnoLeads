/**
 * Objection Card tRPC Router (Refs #157)
 *
 * The card shows the organization's sales playbook, so the same people as the playbook may read
 * it: those who can read leads, except viewers from a parent organization (#74).
 */

import { canReadPlaybook } from '@/lib/features/ax-playbook/access';
import { jstDate } from '@/lib/features/leads/types/pipeline';
import { organizationProcedure, router } from '@/lib/trpc/init';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { getObjectionCard } from '../service';

export const objectionCardRouter = router({
  get: organizationProcedure
    .input(z.object({ organizationId: z.string().uuid(), leadId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      if (!canReadPlaybook(ctx)) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You do not have permission to read the sales playbook',
        });
      }
      const card = await getObjectionCard(ctx.db, {
        organizationId: ctx.organization.id,
        leadId: input.leadId,
      });
      if (!card) throw new TRPCError({ code: 'NOT_FOUND', message: 'Lead not found' });
      return {
        ...card,
        today: jstDate(),
        // Adding a takeaway (#85) needs permission to update leads
        canAddTakeaway: ctx.ability.can('update', 'Lead'),
      };
    }),
});
