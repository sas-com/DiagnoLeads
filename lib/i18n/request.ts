import { getRequestConfig } from 'next-intl/server';
import { type Locale, locales } from './config';
import { messages } from './messages';

/**
 * next-intl Request Configuration
 *
 * サーバーコンポーネントとAPIルートで使用するロケール設定
 * この関数は各リクエストごとに呼ばれ、適切なメッセージを読み込む
 */
export default getRequestConfig(async ({ requestLocale }) => {
  // リクエストから取得したロケールをLocale型に変換
  // requestLocaleがundefinedの場合はデフォルトロケールを使用
  let locale = (await requestLocale) as Locale | undefined;

  // サポートされていないロケールの場合はデフォルトにフォールバック
  if (!locale || !locales.includes(locale)) {
    locale = 'ja'; // デフォルトロケール
  }

  return {
    locale,
    // common.json と名前空間ごとのファイルをまとめたもの（lib/i18n/messages.ts、#472）
    messages: messages[locale],

    /**
     * タイムゾーン設定
     * ユーザーのブラウザタイムゾーンを使用
     */
    timeZone: 'Asia/Tokyo',

    /**
     * 時刻フォーマット設定
     */
    now: new Date(),

    /**
     * エラーハンドリング
     * 開発環境では詳細なエラー、本番環境では控えめなエラー
     */
    onError:
      process.env.NODE_ENV === 'development'
        ? (error) => {
            console.error('[next-intl] Error:', error);
          }
        : undefined,

    /**
     * 翻訳が見つからない場合のフォールバック
     * デフォルトでキーをそのまま表示
     */
    getMessageFallback: ({ key, namespace }) => {
      if (process.env.NODE_ENV === 'development') {
        console.warn(`[next-intl] Missing message: ${namespace ? `${namespace}.` : ''}${key}`);
      }
      return `[Missing: ${key}]`;
    },
  };
});
