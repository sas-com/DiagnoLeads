import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { postgresAdapter } from '@payloadcms/db-postgres';
import { lexicalEditor } from '@payloadcms/richtext-lexical';
import { en } from '@payloadcms/translations/languages/en';
import { ja } from '@payloadcms/translations/languages/ja';
import { buildConfig } from 'payload';
import sharp from 'sharp';

import { AxColumns, Media, Users } from './cms/collections';
import { cmsPoolConfig } from './lib/cms/db-pool';
import { payloadSecret } from './lib/cms/secret';

const dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Payload CMS Configuration
 * Headless CMS for managing content in DiagnoLeads
 */
export default buildConfig({
  // Admin panel settings
  admin: {
    user: Users.slug,
    meta: {
      titleSuffix: '- DiagnoLeads CMS',
      icons: [
        {
          rel: 'icon',
          type: 'image/x-icon',
          url: '/favicon.ico',
        },
      ],
    },
    // Custom DiagnoLeads branding
    components: {
      graphics: {
        Logo: '/cms/components/Logo#Logo',
        Icon: '/cms/components/Icon#Icon',
      },
      providers: ['/cms/components/StyleProvider#StyleProvider'],
    },
  },

  // Collections
  collections: [Users, Media, AxColumns],

  // Global configuration
  globals: [],

  // Rich text editor
  editor: lexicalEditor(),

  // Secret key: no default. Throws here when the CMS is on and PAYLOAD_SECRET is missing; with
  // the CMS off it stays empty so builds pass, and Payload refuses to start (lib/cms/secret.ts)
  secret: payloadSecret(),

  // TypeScript output
  typescript: {
    outputFile: 'cms/payload-types.ts',
  },

  // Database adapter - PostgreSQL with separate schema
  // Schema push rewrites the cms schema (ALTER) on the first CMS request in dev.
  // It runs only when PAYLOAD_PUSH=true, so a wrong DATABASE_URL cannot alter
  // the production schema by accident (#235).
  db: postgresAdapter({
    // TLS settings matching the production database (lib/cms/db-pool.ts, #141)
    pool: cmsPoolConfig(process.env.DATABASE_URL || ''),
    schemaName: 'cms',
    push: process.env.PAYLOAD_PUSH === 'true',
    // Migrations of the cms schema (#418). Production gets them as SQL the owner runs in the
    // SQL Editor (cms/migrations/sql/), which also records them in cms.payload_migrations.
    migrationDir: path.resolve(dirname, 'cms/migrations'),
  }),

  // Image processing
  sharp,

  // Localization (content languages)
  localization: {
    locales: [
      {
        label: '日本語',
        code: 'ja',
      },
      {
        label: 'English',
        code: 'en',
      },
    ],
    defaultLocale: 'ja',
    fallback: true,
  },

  // i18n (admin UI language)
  i18n: {
    supportedLanguages: { ja, en },
    fallbackLanguage: 'ja',
  },

  // Upload settings
  upload: {
    limits: {
      fileSize: 10000000, // 10MB
    },
  },
});
