import { SignupForm } from '@/components/auth/SignupForm';
import Link from 'next/link';
import { Suspense } from 'react';

/**
 * サインアップページ
 */
export default function SignupPage() {
  return (
    <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10 dark:bg-gray-800">
      <h2 className="text-2xl font-bold text-center text-gray-900 dark:text-gray-100 mb-6">
        新規登録
      </h2>

      <Suspense fallback={<div className="text-center py-4">Loading...</div>}>
        <SignupForm />
      </Suspense>

      <div className="mt-6">
        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-300 dark:border-gray-600" />
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="px-2 bg-white text-gray-500 dark:bg-gray-800 dark:text-gray-400">
              すでにアカウントをお持ちの方
            </span>
          </div>
        </div>

        <div className="mt-6">
          <Link
            href="/login"
            className="w-full flex justify-center py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            ログイン
          </Link>
        </div>
      </div>

      {/* TODO: ソーシャルログイン (Google, GitHub) */}
    </div>
  );
}
