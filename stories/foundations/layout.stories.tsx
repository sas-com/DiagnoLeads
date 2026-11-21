import type { Meta, StoryObj } from '@storybook/nextjs-vite';

const SPACING = [
  { className: 'w-1', label: '1（4px）' },
  { className: 'w-2', label: '2（8px）' },
  { className: 'w-3', label: '3（12px）' },
  { className: 'w-4', label: '4（16px）' },
  { className: 'w-6', label: '6（24px）' },
  { className: 'w-8', label: '8（32px）' },
  { className: 'w-12', label: '12（48px）' },
] as const;

const RADIUS = [
  { className: 'rounded-sm', label: 'rounded-sm' },
  { className: 'rounded-md', label: 'rounded-md（ボタン・入力欄）' },
  { className: 'rounded-lg', label: 'rounded-lg（カード）' },
  { className: 'rounded-full', label: 'rounded-full（バッジ）' },
] as const;

function Layout() {
  return (
    <div className="space-y-10">
      <section className="space-y-3">
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-50">余白</h2>
        <p className="max-w-3xl text-base text-gray-700 dark:text-gray-200">
          Tailwind の目盛り（4px 刻み）を使う。並んだ部品の間は gap で取り、部品ごとの margin
          で調整しない。
        </p>
        <ul className="space-y-2">
          {SPACING.map((step) => (
            <li key={step.label} className="flex items-center gap-4">
              <span className={`h-4 bg-brand-500 dark:bg-brand-400 ${step.className}`} />
              <span className="text-sm text-gray-700 dark:text-gray-200">{step.label}</span>
            </li>
          ))}
        </ul>
      </section>
      <section className="space-y-3">
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-50">角丸</h2>
        <div className="flex flex-wrap gap-6">
          {RADIUS.map((radius) => (
            <div key={radius.label} className="space-y-1">
              <div
                className={`h-16 w-24 border border-gray-400 bg-gray-100 dark:border-gray-400 dark:bg-gray-700 ${radius.className}`}
              />
              <p className="text-sm text-gray-700 dark:text-gray-200">{radius.label}</p>
            </div>
          ))}
        </div>
      </section>
      <section className="space-y-3">
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-50">区切りと影</h2>
        <p className="max-w-3xl text-base text-gray-700 dark:text-gray-200">
          面は枠線で区切る。影は、ほかの上に重なって出る部品（ダイアログ・メニュー・シート）だけに使う。
        </p>
        <div className="flex flex-wrap gap-6">
          <div className="w-56 rounded-lg border border-gray-300 bg-white p-4 text-base text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-50">
            枠線で区切る（カード）
          </div>
          <div className="w-56 rounded-lg border border-gray-300 bg-white p-4 text-base text-gray-900 shadow-lg dark:border-gray-600 dark:bg-gray-800 dark:text-gray-50">
            影あり（重なる部品だけ）
          </div>
        </div>
      </section>
      <section className="space-y-3">
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-50">押せる範囲</h2>
        <p className="max-w-3xl text-base text-gray-700 dark:text-gray-200">
          押せる範囲は 44px 以上（min-h-11）。小さいアイコンのボタンも、当たりの範囲は 44px にする。
        </p>
        <div className="flex h-11 w-11 items-center justify-center rounded-md border border-dashed border-gray-500 text-sm text-gray-700 dark:border-gray-300 dark:text-gray-200">
          44
        </div>
      </section>
    </div>
  );
}

const meta = {
  title: '基礎/余白・角丸・影',
  component: Layout,
  tags: ['!autodocs'],
} satisfies Meta<typeof Layout>;

export default meta;
export const 余白と角丸と影: StoryObj<typeof meta> = {};
