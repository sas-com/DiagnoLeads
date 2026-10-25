/**
 * Organization that receives leads from the AX migration diagnosis.
 * resolveDiagnosisOrganizationId() returns null when not configured so the endpoint can refuse
 * instead of silently creating leads in an unexpected organization, and the id in lower case,
 * as the database holds it (#698). Compare an organization with it through
 * isDiagnosisOrganization (lib/multi-tenant/helpers/diagnosis-organization.ts), the one
 * comparison, never with ===.
 */
export { resolveDiagnosisOrganizationId } from '@/lib/multi-tenant/helpers/diagnosis-organization';
