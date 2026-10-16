const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
/** URL parameters node-postgres turns into TLS settings, which would override ours */
const TLS_PARAMS = ['sslmode', 'ssl', 'sslcert', 'sslkey', 'sslrootcert', 'uselibpqcompat'];

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
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    // Not a URL (a socket path, for example): leave it to node-postgres as it is
    return { connectionString, ssl: false };
  }
  for (const param of TLS_PARAMS) url.searchParams.delete(param);
  return {
    connectionString: url.toString(),
    ssl: LOCAL_HOSTS.has(url.hostname.toLowerCase()) ? false : { rejectUnauthorized: false },
  };
}
