/**
 * Links of the AX migration site.
 * Optional URLs come from environment variables so that marketing can add them without a code
 * change; the corresponding links are hidden while they are not set.
 */
export const AX_SITE_LINKS = {
  operator: 'https://sas-com.com/',
  relatedService: 'https://maru2-dx.com/',
} as const;

/** Phone and email of the DX Services Division, as printed on the AX migration brochure */
export const AX_CONTACT = {
  email: 'dx-agency@sas-com.com',
  phone: '03-5427-3663',
  phoneE164: '+81354273663',
} as const;

/** Privacy policy linked from the consent text and the footer */
export function axPrivacyPolicyUrl(): string | undefined {
  return process.env.NEXT_PUBLIC_AX_PRIVACY_POLICY_URL || undefined;
}

/** Booking page for a consultation without taking the diagnosis (e.g. Microsoft Bookings) */
export function axConsultationUrl(): string | undefined {
  return process.env.NEXT_PUBLIC_AX_CONSULTATION_URL || undefined;
}

/** Section anchors on the landing page */
export const AX_SECTIONS = {
  problems: 'problems',
  steps: 'steps',
  targets: 'targets',
  diagnosis: 'diagnosis',
  faq: 'faq',
} as const;
