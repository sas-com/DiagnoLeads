/**
 * Who may edit the site-wide field glossary (#800): owners and admins of the operator's
 * organization, the one that receives the AX diagnosis (owner's decision 2026-11-06,
 * decision 2026-11-06-field-glossary-editors). The dictionary is shared by every organization, so
 * an owner or admin of any other organization may not change it. content_editors is not used: it
 * is being dropped (#339 P2).
 */

import {
  isDiagnosisOrganization,
  resolveDiagnosisOrganizationId,
} from '@/lib/multi-tenant/helpers/diagnosis-organization';

export const FIELD_GLOSSARY_EDITOR_ROLES: readonly string[] = ['owner', 'admin'];

/**
 * Whether a member with this role in this organization may edit the glossary. No one may while
 * no operator organization is configured.
 */
export function canEditFieldGlossary(organizationId: string, role: string): boolean {
  return (
    FIELD_GLOSSARY_EDITOR_ROLES.includes(role) &&
    isDiagnosisOrganization(organizationId, resolveDiagnosisOrganizationId())
  );
}
