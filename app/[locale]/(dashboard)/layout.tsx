import DashboardShell from '@/components/layout/DashboardShell';
import { NextIntlClientProvider } from 'next-intl';

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
