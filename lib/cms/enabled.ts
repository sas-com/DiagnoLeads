/**
 * Whether the CMS (Payload) runs. It is off in production until it is decided to use it there
 * (#141): its tables do not exist in the production database. CMS_ENABLED=true / false
 * overrides the default.
 */
export function isCmsEnabled(): boolean {
  const setting = process.env.CMS_ENABLED?.trim().toLowerCase();
  if (setting === 'true') return true;
  if (setting === 'false') return false;
  return process.env.NODE_ENV !== 'production';
}

/**
 * The app's own API: the folders of app/api (checked by a unit test). Every other /api path is
 * served by Payload's catch-all route (app/(payload)/api/[...slug]) or its GraphQL routes.
 */
export const APP_API_SEGMENTS = [
  'auth',
  'cms',
  'cron',
  'diagnoses',
  'diagnostic',
  'diagnostics',
  // Unsubscribe of respondent mail (#154)
  'email',
  'embed',
  'health',
  'trpc',
  'v2',
] as const;

/** App routes that only serve CMS editors (event stream): off with the CMS too */
const CMS_TOOL_SEGMENTS = new Set(['cms']);
const APP_API = new Set<string>(
  APP_API_SEGMENTS.filter((segment) => !CMS_TOOL_SEGMENTS.has(segment))
);

/** A request Payload or a CMS tool would answer, which must not run while the CMS is off */
export function isCmsApiPath(pathname: string): boolean {
  let path = pathname;
  try {
    // Judge the path the router will serve: "/api/tr%70c" is "/api/trpc"
    path = decodeURIComponent(pathname);
  } catch {
    // Judge a malformed escape as it is
  }
  if (!path.startsWith('/api/')) return false;
  // An encoded slash is not a separator for the router: "/api/health%2Fx" reaches Payload
  if (/%2f/i.test(pathname)) return true;
  const segment = path.slice('/api/'.length).split('/')[0];
  // Routes match case-sensitively: "/api/TRPC" is not the app's and falls through to Payload
  return !APP_API.has(segment);
}
