import { APIError, type CollectionBeforeChangeHook } from 'payload';
import { isAdmin } from '../access/roles';

export const PUBLISH_ADMIN_ONLY_MESSAGE = 'Only an admin can publish. Save it as a draft instead.';

/**
 * Only admins publish (Epic #339, #418). Editors create and update drafts; access.update cannot
 * tell a publish from a draft save, so the status is checked here.
 *
 * How Payload passes the status (payload 3.91, collections/operations/utilities/update.js):
 * - "Publish" sends `_status: 'published'` in the data, with draft off.
 * - "Save draft" sends `draft: true`; Payload then sets `data._status = 'draft'` before the hooks
 *   and writes only a new version, so the published document stays as it is.
 * - An update without `_status` and without draft writes the main document and keeps its status:
 *   on a published article that changes the live text, so it counts as publishing too.
 *
 * Requests without a user are the Local API with overrideAccess (scripts, migrations): REST and
 * GraphQL requests without a user never get here, because access.create / update refuse them.
 */
export const publishAdminOnly: CollectionBeforeChangeHook = ({ data, originalDoc, req }) => {
  if (!req.user || isAdmin(req.user)) return data;
  const status: unknown = data?._status ?? originalDoc?._status;
  if (status === 'published') {
    throw new APIError(PUBLISH_ADMIN_ONLY_MESSAGE, 403, null, true);
  }
  return data;
};
