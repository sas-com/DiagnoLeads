import Link from 'next/link';
import './globals.css';

/**
 * Last-resort not found page (outside [locale], e.g. an unsupported locale). The root layout
 * returns its children only, so this page brings its own <html> and <body>.
 */
export default function NotFound() {
  return (
    <html lang="ja">
      <body>
        <main className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
          <div className="text-center">
            <p className="text-sm font-semibold text-gray-500">404</p>
            <h1 className="mt-1 text-2xl font-bold text-gray-900">ページが見つかりません</h1>
            <p className="mt-3 text-gray-600">
              お探しのページは存在しないか、移動した可能性があります。
            </p>
            <Link
              href="/"
              className="mt-6 inline-block rounded-lg bg-teal-600 px-6 py-3 text-white transition-colors hover:bg-teal-700"
            >
              ホームに戻る
            </Link>
          </div>
        </main>
      </body>
    </html>
  );
}
