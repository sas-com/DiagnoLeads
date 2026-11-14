import { ResetPasswordForm } from '@/components/auth/ResetPasswordForm';
import Link from 'next/link';

/**
 * パスワードリセットページ
 */
export default function ResetPasswordPage() {
  return (
    <div className="border border-gray-300 border-t-2 border-t-brand-400 bg-white py-8 px-4 sm:rounded-lg sm:px-10 dark:border-gray-700 dark:border-t-brand-400 dark:bg-gray-900">
      <h2 className="text-2xl font-bold text-center text-gray-900 dark:text-gray-100 mb-2">
        パスワードリセット
      </h2>
      <p className="text-center text-sm text-gray-600 dark:text-gray-400 mb-6">
        登録されているメールアドレスを入力してください。
        <br />
        パスワードリセット用のリンクをお送りします。
      </p>

      <ResetPasswordForm />

      <div className="mt-6 text-center">
        <Link
          href="/login"
          className="text-sm font-medium text-brand-500 underline hover:text-brand-600 dark:text-brand-400 dark:hover:text-brand-300"
        >
          ← ログインページに戻る
        </Link>
      </div>
    </div>
  );
}
