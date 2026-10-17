import { AX_CLIENT_MESSAGES, pickMessages } from '@/lib/i18n/client-messages';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';

/**
 * AX migration site (landing page and diagnosis).
 * Its own group so that the page HTML carries only the diagnosis messages, not the catalog of the
 * admin screens; metadata comes from each page.
 */
export default async function AxLayout({ children }: { children: React.ReactNode }) {
  const messages = await getMessages();
  return (
    <NextIntlClientProvider messages={pickMessages(messages, AX_CLIENT_MESSAGES)}>
      {children}
    </NextIntlClientProvider>
  );
}
