/**
 * The CMS is off in production until it is decided to use it there (#141)
 */
import { DisabledCMSAdapter } from '@/lib/cms/adapters/disabled/adapter';
import { cmsPoolConfig } from '@/lib/cms/db-pool';
import { APP_API_SEGMENTS, isCmsEnabled, isCmsApiPath } from '@/lib/cms/enabled';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('CMS on or off', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('is off in production and on elsewhere, unless CMS_ENABLED says otherwise', () => {
    vi.stubEnv('CMS_ENABLED', '');
    vi.stubEnv('NODE_ENV', 'production');
    expect(isCmsEnabled()).toBe(false);
    vi.stubEnv('CMS_ENABLED', 'true');
    expect(isCmsEnabled()).toBe(true);
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('CMS_ENABLED', '');
    expect(isCmsEnabled()).toBe(true);
    vi.stubEnv('CMS_ENABLED', 'false');
    expect(isCmsEnabled()).toBe(false);
  });

  it("treats every /api path that is not the app's own as the CMS's, and the CMS tools too", () => {
    for (const path of ['/api/cms/ai-generate', '/api/cms/figma/webhook', '/api/cms-users', '/api/cms-users/me', '/api/blog-posts', '/api/graphql', '/api/anything', '/api/TRPC/x', '/api/', '/api/health%2Fx', '/api/tr%70c%2fx']) {
      expect(isCmsApiPath(path), path).toBe(true);
    }
    for (const path of ['/api/trpc/content.blog.list', '/api/tr%70c/x', '/api/auth/sign-in/email', '/api/health', '/api/cron/cleanup-webhook-deliveries', '/api/embed/v1/x', '/ja/blog', '/apix']) {
      expect(isCmsApiPath(path), path).toBe(false);
    }
  });

  it('knows every API folder of the app', () => {
    const folders = readdirSync(join(process.cwd(), 'app/api'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    expect([...APP_API_SEGMENTS].sort()).toEqual(folders.sort());
  });

  it('shows no content and saves nothing while off', async () => {
    const adapter = new DisabledCMSAdapter();
    expect((await adapter.find({ collection: 'blog-posts' })).data).toEqual([]);
    expect((await adapter.findBySlug({ collection: 'blog-posts', slug: 'x' })).data).toBeNull();
    await expect(adapter.create({ collection: 'faqs', data: {} })).rejects.toThrow('not enabled');
  });
});

describe('CMS database connection', () => {
  it('encrypts without verifying the certificate, as the app client does, and drops sslmode', () => {
    const config = cmsPoolConfig('postgres://u:p@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres?sslmode=require');
    expect(config.ssl).toEqual({ rejectUnauthorized: false });
    expect(config.connectionString).not.toContain('sslmode');
    expect(config.connectionString).toContain('pooler.supabase.com:5432/postgres');
  });

  it('drops every TLS setting of the URL, which node-postgres would let override ours', () => {
    const { connectionString } = cmsPoolConfig(
      'postgres://u:p%40x@db.example.com:5432/postgres?ssl=true&sslrootcert=/ca.crt&uselibpqcompat=true&pgbouncer=true'
    );
    expect(connectionString).toBe('postgres://u:p%40x@db.example.com:5432/postgres?pgbouncer=true');
  });

  it('leaves a connection string that is not a URL to node-postgres', () => {
    expect(cmsPoolConfig('postgres://u:p@/db?host=/var/run/postgresql x')).toMatchObject({ ssl: false });
  });

  it('uses a local database without TLS', () => {
    expect(cmsPoolConfig('postgres://postgres:postgres@LOCALHOST:5432/dl_test').ssl).toBe(false);
    expect(cmsPoolConfig('postgres://postgres:postgres@127.0.0.1:55433/dl_test').ssl).toBe(false);
    expect(cmsPoolConfig('').ssl).toBe(false);
  });
});
