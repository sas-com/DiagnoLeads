import { accessSupport } from '@/lib/features/diagnostics/ax-migration/access-support';
import { multiple, single } from '@/lib/features/diagnostics/engine';
import type { DiagnosticAnswers } from '@/lib/features/diagnostics/types';

/**
 * The one column the Access result recommends (#363), chosen from the answers. The first rule
 * that matches wins:
 *
 * 1. a version whose support has ended (the same check as the result's urgency reason
 *    `access_support_ended`) → the Office support end article
 * 2. the data file is near the 2 GB limit, or already split to stay under it → the 2 GB article
 * 3. only .accde / .mde files are left (or parts are locked) → the accde article
 * 4. stored in a shared folder and used by three people or more → the shared folder article
 * 5. otherwise → the article on fixing Access or moving it to the web
 *
 * Most of these questions are optional follow-ups asked after the result, so the choice can
 * change once they are answered.
 */
export const RESULT_COLUMN_SLUGS = [
  'access-office-support-end',
  'access-2gb-limit',
  'access-accde-only',
  'access-shared-folder',
  'access-fix-or-web',
] as const;
export type ResultColumnSlug = (typeof RESULT_COLUMN_SLUGS)[number];

/** access_size: 1 GB or more (close to the limit), or split by year to stay under it */
const NEAR_LIMIT_SIZES: ReadonlySet<string> = new Set(['gte1gb', 'split']);
/** access_users: more than one or two people */
const SEVERAL_USERS: ReadonlySet<string> = new Set(['3_10', '11_30', 'gte31']);

export function resultColumnSlug(
  platform: string,
  answers: DiagnosticAnswers,
  now: Date
): ResultColumnSlug | null {
  if (platform !== 'access') return null;
  if (accessSupport(multiple(answers, 'access_version'), now) === 'ended') {
    return 'access-office-support-end';
  }
  if (NEAR_LIMIT_SIZES.has(single(answers, 'access_size') ?? '')) return 'access-2gb-limit';
  if (single(answers, 'access_sources') === 'compiled') return 'access-accde-only';
  if (
    single(answers, 'access_location') === 'shared_folder' &&
    SEVERAL_USERS.has(single(answers, 'access_users') ?? '')
  ) {
    return 'access-shared-folder';
  }
  return 'access-fix-or-web';
}
