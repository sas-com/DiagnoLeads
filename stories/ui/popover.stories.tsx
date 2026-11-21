import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';

const meta = {
  title: '部品/Popover',
  component: Popover,
} satisfies Meta<typeof Popover>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline">絞り込み</Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 space-y-2 text-base">
        <p className="font-bold">絞り込みの条件</p>
        <p className="text-sm text-gray-700 dark:text-gray-200">
          ボタンのそばに出る小さな面。短い入力や選択に使い、長い入力はダイアログにする。
        </p>
      </PopoverContent>
    </Popover>
  ),
};
