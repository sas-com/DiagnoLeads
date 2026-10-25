/**
 * The organization that receives the AX diagnosis (AX_DIAGNOSIS_ORGANIZATION_ID, else
 * DEFAULT_ORGANIZATION_ID): its answers become that organization's leads, and only its campaigns
 * and links send people to the AX diagnosis.
 *
 * Here, below the features, so that every feature that compares an organization with it reads
 * the same rule, also the ones that must not import another feature (lib/features/distribution,
 * decision 2026-10-24-qr-short-code-entry). The features import it through
 * lib/features/diagnostics/organization.ts.
 */
import { env } from '@/lib/env';

/**
 * The id of the organization that receives the AX diagnosis, in lower case, or null when none
 * is configured. The environment may hold the uuid in either case (z.string().uuid() lets both
 * through); PostgreSQL returns a uuid in lower case, so the id is handed out as the database
 * holds it (#698)
 */
export function resolveDiagnosisOrganizationId(): string | null {
  return (env.AX_DIAGNOSIS_ORGANIZATION_ID ?? env.DEFAULT_ORGANIZATION_ID)?.toLowerCase() ?? null;
}

/**
 * Whether this organization receives the AX diagnosis: the one comparison of an organization
 * with resolveDiagnosisOrganizationId() (#698). Both ids are compared in one case, so a uuid set
 * in upper case in the environment gives the same answer everywhere. No organization does while
 * none is configured.
 * The id to compare with is passed in (resolveDiagnosisOrganizationId()), so the callers that
 * stub that function in their tests keep doing so.
 */
export function isDiagnosisOrganization(
  organizationId: string,
  diagnosisOrganizationId: string | null
): boolean {
  return (
    diagnosisOrganizationId !== null &&
    diagnosisOrganizationId.toLowerCase() === organizationId.toLowerCase()
  );
}
