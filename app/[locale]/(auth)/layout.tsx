import { AppToaster } from '@/components/common/AppToaster';
import { ThemeProvider } from '@/context/ThemeContext';
import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata({
  params,
}: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'settings.auth.metadata' });

  return {
    title: t('title'),
    description: t('description'),
  };
}

/**
 * 認証レイアウト
 * ログイン、サインアップ、パスワードリセットページで共有
 */
export default async function AuthLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'settings.auth.branding' });

  return (
    // The whole catalog for the client components (the locale layout passes only a small part)
    <NextIntlClientProvider>
      {/* Same theme as the app (the OS setting, or the choice made with the toggle) */}
      <ThemeProvider>
        <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8 dark:bg-gray-900">
          <div className="max-w-md w-full space-y-8">
            <div className="text-center">
              <h1 className="text-4xl font-bold text-gray-900 dark:text-gray-100">{t('title')}</h1>
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">{t('subtitle')}</p>
            </div>
            {children}
          </div>
        </div>
      </ThemeProvider>
      <AppToaster />
    </NextIntlClientProvider>
  );
}
