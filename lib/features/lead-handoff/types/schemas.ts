import { z } from 'zod';
import { MAX_HANDOFF_RECIPIENTS } from '../handoff';

/** Handoff sheet of the first meeting (Refs #86) */

export const leadScopeSchema = z.object({
  organizationId: z.string().uuid(),
  leadId: z.string().uuid(),
});

export const handoffSettingsSchema = z.object({ organizationId: z.string().uuid() });

export const setHandoffRecipientsSchema = z.object({
  organizationId: z.string().uuid(),
  userIds: z.array(z.string().uuid()).max(MAX_HANDOFF_RECIPIENTS),
});
