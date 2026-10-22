'use client';

import { OrganizationProvider } from '@/lib/context/organization-context';
import { trpc } from '@/lib/trpc/client';
import { retryUnlessDenied } from '@/lib/trpc/retry';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { httpBatchLink } from '@trpc/client';
import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import superjson from 'superjson';

/**
 * Loaded only where it is rendered: the AX migration site shows no toasts, so it does not load
 * sonner at all (#207). sonner's runtime <style> tag is patched out (#213).
 */
const AppToaster = dynamic(
  () => import('@/components/common/AppToaster').then((module) => module.AppToaster),
  { ssr: false }
);

/** The AX migration site (landing page and diagnosis), in either language */
const isAxSitePath = (pathname: string | null) =>
  pathname !== null && /^\/(ja|en)\/ax-(migration|diagnosis)(\/|$)/.test(pathname);

/**
 * Create Query Client with optimized cache strategy
 *
 * Performance optimizations:
 * - Longer stale time for analytics data (less frequent refetch)
 * - Aggressive garbage collection to reduce memory usage
 * - Retry strategy to handle network failures gracefully
 * - Cache time configuration to balance freshness and performance
 */
function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Cache Strategy
        staleTime: 5 * 60 * 1000, // 5 minutes (data considered fresh)
        gcTime: 10 * 60 * 1000, // 10 minutes (garbage collection time, formerly cacheTime)

        // Refetch Strategy
        refetchOnWindowFocus: false, // Don't refetch on window focus (reduce unnecessary requests)
        refetchOnMount: true, // Refetch on component mount
        refetchOnReconnect: true, // Refetch on network reconnect

        // Retry Strategy
        retry: retryUnlessDenied(2), // Retry failed requests twice, but not auth errors
        retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000), // Exponential backoff

        // Performance
        structuralSharing: true, // Enable structural sharing (reduce re-renders)
      },
      mutations: {
        // Retry mutations once on failure
        retry: retryUnlessDenied(1),
        retryDelay: 1000,
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined = undefined;

function getQueryClient() {
  if (typeof window === 'undefined') {
    // Server: always make a new query client
    return makeQueryClient();
  }
  // Browser: make a new query client if we don't already have one
  if (!browserQueryClient) browserQueryClient = makeQueryClient();
  return browserQueryClient;
}

/**
 * App Providers
 * Wraps the application with tRPC and React Query providers
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const queryClient = getQueryClient();

  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url: `${process.env.NEXT_PUBLIC_APP_URL}/api/trpc`,
          transformer: superjson,
        }),
      ],
    })
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <OrganizationProvider>
          {children}
          {/* One toaster at the root so that a toast survives moving between route groups
              (signed in → dashboard); none on the AX site, which shows no toasts */}
          {!isAxSitePath(pathname) && <AppToaster />}
        </OrganizationProvider>
      </QueryClientProvider>
    </trpc.Provider>
  );
}
