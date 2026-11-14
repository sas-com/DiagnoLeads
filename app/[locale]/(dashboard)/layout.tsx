import DashboardShell from '@/components/layout/DashboardShell';
import { APP_INSTALL_METADATA } from '@/lib/routes/app-install';
import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';

/** The admin pages belong to the installable app (#1125) */
export const metadata: Metadata = APP_INSTALL_METADATA;

/**
 * Dashboard Layout
 *
 * The admin screens' client components use messages from every namespace, so they get the whole
 * catalog (inherited from i18n/request); the locale layout passes only a small part.
 */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <NextIntlClientProvider>
      <DashboardShell>{children}</DashboardShell>
    </NextIntlClientProvider>
  );
}
