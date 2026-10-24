/**
 * Links of the AX migration site.
 * Optional URLs come from environment variables so that marketing can add them without a code
 * change; the corresponding links are hidden while they are not set.
 */
export const AX_SITE_LINKS = {
  operator: 'https://sas-com.com/',
  relatedService: 'https://maru2-dx.com/',
  /** Order entry screen before and after the migration, switchable on the spot (#414) */
  demo: 'https://as400-pre-migration.vercel.app/',
} as const;

// Contact and policy links live in lib so server code (respondent mail) can use them (#154)
export { AX_CONTACT, axConsultationUrl, axPrivacyPolicyUrl } from '@/lib/features/ax-site/contact';

/** Last call to action and footer: the phone CTA bar stays hidden while they are on screen */
export const AX_FINAL_SECTION_ID = 'ax-final';
/** Diagnosis button below the concerns: the phone CTA bar stays hidden next to it as well */
export const AX_PROBLEMS_CTA_ID = 'ax-problems-cta';
export const AX_FOOTER_ID = 'ax-footer';
/** Diagnosis buttons of the hero and the consultation band: the phone CTA bar stays hidden too */
export const AX_HERO_CTA_ID = 'ax-hero-cta';
export const AX_CONSULT_BAND_ID = 'ax-consult';

/** Section anchors on the landing page */
export const AX_SECTIONS = {
  problems: 'problems',
  reasons: 'reasons',
  demo: 'demo',
  steps: 'steps',
  targets: 'targets',
  /** Sections for readers of one host platform (#311) */
  as400: 'as400-migration',
  acos: 'acos-migration',
  diagnosis: 'diagnosis',
  faq: 'faq',
} as const;
