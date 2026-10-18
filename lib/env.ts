import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod';

export const env = createEnv({
  /**
   * Server-side environment variables schema
   */
  server: {
    // Database
    DATABASE_URL: z.string().url(),

    // Auth
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.string().url(),

    // Email
    RESEND_API_KEY: z.string().optional(),

    // AI
    ANTHROPIC_API_KEY: z.string().optional(),

    // Jobs
    TRIGGER_API_KEY: z.string().optional(),
    TRIGGER_API_URL: z.string().url().optional(),

    // Node environment
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

    // Public diagnostic form
    DEFAULT_ORGANIZATION_ID: z.string().uuid().optional(),

    // AX migration diagnosis: organization that receives the leads (falls back to DEFAULT_ORGANIZATION_ID)
    AX_DIAGNOSIS_ORGANIZATION_ID: z.string().uuid().optional(),
    // Comma-separated sales addresses notified on consultation requests
    AX_DIAGNOSIS_SALES_EMAIL: z.string().optional(),
    // Comma-separated addresses told about server errors (lib/ops/alert.ts); falls back to the AX sales address
    OPS_ALERT_EMAIL: z.string().optional(),

    // Cloudflare Turnstile on the public diagnosis: checked only when both keys are set
    TURNSTILE_SITE_KEY: z.string().optional(),
    TURNSTILE_SECRET_KEY: z.string().optional(),

    // FAQ / blog editors (comma-separated emails); unset = nobody can edit (#87)
    CONTENT_EDITOR_EMAILS: z.string().optional(),

    // Legacy generic diagnosis form: off in production unless 'true' (#71)
    LEGACY_DIAGNOSTIC_FORM_ENABLED: z.string().optional(),
  },

  /**
   * Client-side environment variables schema
   * Must be prefixed with NEXT_PUBLIC_
   */
  client: {
    NEXT_PUBLIC_APP_URL: z.string().url(),
    NEXT_PUBLIC_APP_NAME: z.string().default('DiagnoLeads'),
  },

  /**
   * Runtime environment variables
   */
  runtimeEnv: {
    // Server
    DATABASE_URL: process.env.DATABASE_URL,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    TRIGGER_API_KEY: process.env.TRIGGER_API_KEY,
    TRIGGER_API_URL: process.env.TRIGGER_API_URL,
    NODE_ENV: process.env.NODE_ENV,
    DEFAULT_ORGANIZATION_ID: process.env.DEFAULT_ORGANIZATION_ID,
    AX_DIAGNOSIS_ORGANIZATION_ID: process.env.AX_DIAGNOSIS_ORGANIZATION_ID,
    AX_DIAGNOSIS_SALES_EMAIL: process.env.AX_DIAGNOSIS_SALES_EMAIL,
    OPS_ALERT_EMAIL: process.env.OPS_ALERT_EMAIL,
    TURNSTILE_SITE_KEY: process.env.TURNSTILE_SITE_KEY,
    TURNSTILE_SECRET_KEY: process.env.TURNSTILE_SECRET_KEY,
    CONTENT_EDITOR_EMAILS: process.env.CONTENT_EDITOR_EMAILS,
    LEGACY_DIAGNOSTIC_FORM_ENABLED: process.env.LEGACY_DIAGNOSTIC_FORM_ENABLED,

    // Client
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME,
  },

  /**
   * Skip validation in build time for Docker builds
   */
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,

  /**
   * Makes it so that empty strings are treated as undefined.
   */
  emptyStringAsUndefined: true,
});
