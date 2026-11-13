import type { Meta, StoryObj } from '@storybook/nextjs-vite';

const SCALE = [
  { className: 'text-3xl font-bold', label: 'text-3xl（30px）太字', use: 'ページの題' },
  { className: 'text-2xl font-bold', label: 'text-2xl（24px）太字', use: '大きな数字・節の題' },
  { className: 'text-xl font-bold', label: 'text-xl（20px）太字', use: '節の題・シートの題' },
  { className: 'text-lg font-bold', label: 'text-lg（18px）太字', use: '小見出し' },
  { className: 'text-base', label: 'text-base（16px）', use: '本文。これより小さくしない' },
  { className: 'text-sm', label: 'text-sm（14px）', use: '補足だけ。14px 未満は使わない' },
] as const;

function Typography() {
  return (
    <div className="space-y-10">
      <section className="space-y-4">
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-50">大きさ</h2>
        <table className="w-full border-collapse text-left">
          <tbody>
            {SCALE.map((row) => (
              <tr key={row.label} className="border-b border-gray-300 dark:border-gray-600">
                <td className={`py-3 pr-6 text-gray-900 dark:text-gray-50 ${row.className}`}>
                  見込み客を商談に進める
                </td>
                <td className="py-3 pr-6 text-sm text-gray-700 dark:text-gray-200">{row.label}</td>
                <td className="py-3 text-sm text-gray-700 dark:text-gray-200">{row.use}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="space-y-3">
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-50">本文</h2>
        <p className="max-w-2xl text-base leading-relaxed text-gray-900 dark:text-gray-50">
          本文は 16px 以上、行間は 1.5 以上にします。1行は長くしすぎず、読みやすい幅に収めます。
          <strong className="font-bold">強調は太字（700）</strong>
          で示し、色だけ・下線だけで強調しません。
        </p>
        <p className="max-w-2xl text-sm leading-relaxed text-gray-700 dark:text-gray-200">
          補足は 14px。日付・件数の注記・入力欄の説明などに使います。
        </p>
      </section>
      <section className="space-y-3">
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-50">数字</h2>
        <p className="text-2xl font-bold tabular-nums text-gray-900 dark:text-gray-50">
          1,234 件　¥5,678,900
        </p>
        <p className="text-sm text-gray-700 dark:text-gray-200">
          桁をそろえる数字には tabular-nums を付ける。金額は ¥ と3桁区切り。
        </p>
      </section>
    </div>
  );
}

const meta = {
  title: '基礎/文字',
  component: Typography,
  tags: ['!autodocs'],
} satisfies Meta<typeof Typography>;

export default meta;
export const 文字: StoryObj<typeof meta> = {};
