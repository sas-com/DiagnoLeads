import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { SwatchRow } from './swatch';

// The class names are written out in full: Tailwind only generates the classes it can read here
const BRAND = [
  { className: 'bg-brand-50', name: 'brand-50' },
  { className: 'bg-brand-100', name: 'brand-100' },
  { className: 'bg-brand-200', name: 'brand-200' },
  { className: 'bg-brand-300', name: 'brand-300' },
  { className: 'bg-brand-400', name: 'brand-400' },
  { className: 'bg-brand-500', name: 'brand-500' },
  { className: 'bg-brand-600', name: 'brand-600' },
  { className: 'bg-brand-700', name: 'brand-700' },
  { className: 'bg-brand-800', name: 'brand-800' },
] as const;

const GRAY = [
  { className: 'bg-gray-25', name: 'gray-25' },
  { className: 'bg-gray-50', name: 'gray-50' },
  { className: 'bg-gray-100', name: 'gray-100' },
  { className: 'bg-gray-200', name: 'gray-200' },
  { className: 'bg-gray-300', name: 'gray-300' },
  { className: 'bg-gray-400', name: 'gray-400' },
  { className: 'bg-gray-500', name: 'gray-500' },
  { className: 'bg-gray-600', name: 'gray-600' },
  { className: 'bg-gray-700', name: 'gray-700' },
  { className: 'bg-gray-800', name: 'gray-800' },
  { className: 'bg-gray-900', name: 'gray-900' },
] as const;

const MEANING = [
  { className: 'bg-red-500', name: 'red-500（取り消せない操作）' },
  { className: 'bg-red-600', name: 'red-600' },
  { className: 'bg-blue-600', name: 'blue-600（お知らせ）' },
  { className: 'bg-yellow-500', name: 'yellow-500（注意）' },
  { className: 'bg-green-600', name: 'green-600（完了）' },
] as const;

function Colors() {
  return (
    <div className="space-y-10">
      <SwatchRow
        title="キーカラー（brand）"
        note="DADS の Green。brand-500 が主なボタンの塗り（Green-900。白い文字と 8.3:1）。ダークでは、塗りは brand-600、文字とリンクは brand-400 を使う。"
        swatches={BRAND}
      />
      <SwatchRow
        title="グレー（gray）"
        note="DADS の Solid Gray。文字は gray-900（本文）・gray-700・gray-600。補足の文字は gray-500 より薄くしない。gray-400 は枠線とアイコンだけ（3:1）。ダークの文字は gray-50（主）・gray-200（補足）・gray-300（控えめ）。"
        swatches={GRAY}
      />
      <SwatchRow
        title="意味の色"
        note="色だけで意味を伝えない。必ず文字かアイコンを添える。部品の Callout と Badge が、この色の組を持っている。"
        swatches={MEANING}
      />
      <section className="space-y-3">
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-50">文字と面の組み合わせ</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-md border border-gray-300 bg-white p-4 dark:border-gray-600 dark:bg-gray-800">
            <p className="text-base font-bold text-gray-900 dark:text-gray-50">本文の文字（主）</p>
            <p className="text-base text-gray-700 dark:text-gray-200">補足の文字</p>
            <p className="text-sm text-gray-600 dark:text-gray-300">
              控えめな文字（14px は補足だけ）
            </p>
          </div>
          <div className="rounded-md border border-gray-300 bg-gray-50 p-4 dark:border-gray-600 dark:bg-gray-900">
            <p className="text-base font-bold text-gray-900 dark:text-gray-50">画面の地の上</p>
            <p className="text-base text-gray-700 dark:text-gray-200">補足の文字</p>
            <a className="text-base text-brand-500 underline dark:text-brand-400" href="#link">
              リンク
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}

const meta = {
  title: '基礎/色',
  component: Colors,
  tags: ['!autodocs'],
} satisfies Meta<typeof Colors>;

export default meta;
export const 色: StoryObj<typeof meta> = {};
