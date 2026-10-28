import type { ContactKind } from '@/lib/features/lead-follow-up/types/schemas';
import { Building2, Mail, Phone, PhoneOff, Video } from 'lucide-react';
import type { ComponentType } from 'react';

/** One icon per kind of contact record (#136, #554), on the buttons and in the activity */
export const CONTACT_KIND_ICONS: Record<ContactKind, ComponentType<{ className?: string }>> = {
  call: Phone,
  email: Mail,
  no_answer: PhoneOff,
  visit: Building2,
  online_meeting: Video,
};
