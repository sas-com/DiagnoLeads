import { LoginForm } from '@/components/auth/LoginForm';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { Suspense } from 'react';

/**
 * ログインページ
 */
export default async function LoginPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'settings.auth.login' });

  return (
    <div className="border border-gray-300 border-t-2 border-t-brand-400 bg-white py-8 px-4 sm:rounded-lg sm:px-10 dark:border-gray-700 dark:border-t-brand-400 dark:bg-gray-900">
      <h2 className="text-2xl font-bold text-center text-gray-900 dark:text-gray-100 mb-6">
        {t('title')}
      </h2>

      {/* 開発環境用テストユーザー情報 */}
      {process.env.NODE_ENV === 'development' && (
        <div className="mb-6 p-4 bg-brand-50 border border-brand-200 rounded-lg dark:bg-gray-800 dark:border-gray-700">
          <h3 className="text-sm font-semibold text-gray-900 mb-2 dark:text-gray-50">
            {locale === 'ja' ? 'テストユーザー' : 'Test User'}
          </h3>
          <div className="text-sm text-gray-800 space-y-1 dark:text-gray-200">
            <p>
              <span className="font-medium">{locale === 'ja' ? 'メール:' : 'Email:'}</span>{' '}
              <code className="bg-brand-100 px-1 rounded dark:bg-gray-700">test@example.com</code>
            </p>
            <p>
              <span className="font-medium">{locale === 'ja' ? 'パスワード:' : 'Password:'}</span>{' '}
              <code className="bg-brand-100 px-1 rounded dark:bg-gray-700">password123</code>
            </p>
          </div>
        </div>
      )}

      <Suspense fallback={<div className="text-center py-4">Loading...</div>}>
        <LoginForm />
      </Suspense>

      <div className="mt-6">
        <div className="flex items-center justify-between text-sm">
          <Link
            href="/reset-password"
            className="font-medium text-brand-500 underline hover:text-brand-600 dark:text-brand-400 dark:hover:text-brand-300"
          >
            {t('forgotPassword')}
          </Link>
        </div>
      </div>

      <p className="mt-6 text-center text-sm text-gray-500 dark:text-gray-400">
        {t('inviteOnlyNote')}
      </p>

      {/* TODO: ソーシャルログイン (Google, GitHub) */}
    </div>
  );
}
