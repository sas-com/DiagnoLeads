import { env } from '@/lib/env';

/**
 * Organization that receives leads from the AX migration diagnosis.
 * Returns null when not configured so the endpoint can refuse instead of
 * silently creating leads in an unexpected organization.
 */
export function resolveDiagnosisOrganizationId(): string | null {
  return env.AX_DIAGNOSIS_ORGANIZATION_ID ?? env.DEFAULT_ORGANIZATION_ID ?? null;
}
