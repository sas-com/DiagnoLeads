import { withPayload } from '@payloadcms/next/withPayload';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./lib/i18n/request.ts');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    // Temporarily disabled due to i18n dynamic routes
    // typedRoutes: true,
  },
  // External packages for server components (moved from experimental in Next.js 15)
  serverExternalPackages: ['postgres'],

  // The PDF exports read their Japanese font from disk (lib/features/reports/pdf-font.server.ts,
  // #189); bundle it with the tRPC function so it exists on Vercel too
  outputFileTracingIncludes: {
    '/api/trpc/*': ['./public/fonts/NotoSansJP-Regular-subset.ttf'],
  },

  // Performance optimizations
  compiler: {
    // Remove console.log in production
    removeConsole:
      process.env.NODE_ENV === 'production'
        ? {
            exclude: ['error', 'warn'],
          }
        : false,
  },

  // Image optimization
  images: {
    formats: ['image/avif', 'image/webp'],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
  },

  // Bundle optimization
  webpack: (config, { isServer }) => {
    // Optimize bundle size
    if (!isServer) {
      config.resolve.alias = {
        ...config.resolve.alias,
        // Reduce bundle size by using lighter alternatives where possible
      };
    }

    // SVG handling with @svgr/webpack, except the icon files of the app directory
    // (app/**/icon.svg), which Next.js serves as images
    config.module.rules.push({
      test: /\.svg$/,
      resourceQuery: { not: [/__next_metadata__/] },
      use: ['@svgr/webpack'],
    });

    return config;
  },

  // Production optimizations
  ...(process.env.NODE_ENV === 'production' && {
    compress: true,
    productionBrowserSourceMaps: false,
  }),
};

// Bundle Analyzer (run with ANALYZE=true npm run build)
const withBundleAnalyzer =
  process.env.ANALYZE === 'true'
    ? require('@next/bundle-analyzer')({ enabled: true })
    : (config: NextConfig) => config;

/**
 * withPayload adds Accept-CH, Vary and Critical-CH for Sec-CH-Prefers-Color-Scheme to every path.
 * Critical-CH makes Chrome send the first request of a visit again to add the hint (an internal
 * redirect of 0.2-1 s on the landing pages, #497), and only the Payload admin uses it (for its
 * colour theme). Keep these three on /admin only and leave every other header as it is (#509).
 */
type HeaderRule = Awaited<ReturnType<NonNullable<NextConfig['headers']>>>[number];
const PAYLOAD_COLOR_HINT = 'Sec-CH-Prefers-Color-Scheme';
const isPayloadColorHint = ({ key, value }: HeaderRule['headers'][number]) =>
  ['accept-ch', 'critical-ch', 'vary'].includes(key.toLowerCase()) && value === PAYLOAD_COLOR_HINT;

export function scopePayloadColorHints(config: NextConfig): NextConfig {
  const headers = config.headers;
  if (!headers) return config;
  return {
    ...config,
    async headers() {
      const rules = await headers();
      return rules.flatMap((rule): HeaderRule[] => {
        if (rule.source !== '/:path*' || !rule.headers.some(isPayloadColorHint)) return [rule];
        const others = rule.headers.filter((header) => !isPayloadColorHint(header));
        return [
          ...(others.length > 0 ? [{ ...rule, headers: others }] : []),
          { ...rule, source: '/admin/:path*', headers: rule.headers.filter(isPayloadColorHint) },
        ];
      });
    },
  };
}

// Apply plugins: next-intl -> bundle analyzer -> payload, then keep Payload's colour hints on /admin
export default scopePayloadColorHints(withPayload(withNextIntl(withBundleAnalyzer(nextConfig))));
