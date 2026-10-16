const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * Connection pool settings of the CMS database (node-postgres). node-postgres verifies the
 * server certificate when the URL says sslmode=require, which fails on the Supabase pooler's
 * certificate chain ("self-signed certificate", #141). Encrypt without verifying, as the app's
 * own client (postgres-js, sslmode=require) does; the sslmode in the URL is dropped because it
 * would override this setting. Local databases are used without TLS.
 */
export function cmsPoolConfig(connectionString: string): {
  connectionString: string;
  ssl: false | { rejectUnauthorized: false };
} {
  if (!connectionString) return { connectionString, ssl: false };
  const url = new URL(connectionString);
  url.searchParams.delete('sslmode');
  return {
    connectionString: url.toString(),
    ssl: LOCAL_HOSTS.has(url.hostname) ? false : { rejectUnauthorized: false },
  };
}
