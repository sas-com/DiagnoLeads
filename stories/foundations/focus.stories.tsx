import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';

function Focus() {
  return (
    <div className="space-y-6">
      <p className="max-w-3xl text-base text-gray-900 dark:text-gray-50">
        キーボードでフォーカスが当たった要素は、黒の outline（4px）と Yellow
        の枠（2px）の二重で示す。DADS の決まりで、部品ごとに色を変えない。Tab
        キーで下の部品を順に移ると確かめられる。
      </p>
      <div className="flex flex-wrap items-center gap-6">
        <Button>ボタン</Button>
        <Button variant="outline">枠のボタン</Button>
        <Input className="w-56" aria-label="入力欄" placeholder="入力欄" />
        <span className="flex items-center gap-2 text-base text-gray-900 dark:text-gray-50">
          <Checkbox id="focus-check" />
          <label htmlFor="focus-check">チェックボックス</label>
        </span>
        <a className="text-base text-brand-500 underline dark:text-brand-400" href="#focus">
          リンク
        </a>
      </div>
      <div>
        <p className="mb-2 text-sm text-gray-700 dark:text-gray-200">
          フォーカスが当たったときの見え方（見本）
        </p>
        <span className="inline-flex h-10 items-center rounded-md bg-brand-500 px-4 text-sm font-medium text-white shadow-[0_0_0_2px_#ffd43d] outline outline-4 outline-offset-2 outline-black dark:bg-brand-600">
          保存する
        </span>
      </div>
    </div>
  );
}

const meta = {
  title: '基礎/フォーカス',
  component: Focus,
  tags: ['!autodocs'],
} satisfies Meta<typeof Focus>;

export default meta;
export const フォーカス: StoryObj<typeof meta> = {};
