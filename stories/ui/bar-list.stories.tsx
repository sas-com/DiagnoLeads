import { BarList } from '@/components/ui/bar-list';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';

const meta = {
  title: '部品/BarList',
  component: BarList,
  args: {
    data: [
      { name: '診断フォーム', value: 86 },
      { name: '紹介', value: 41 },
      { name: '展示会', value: 23 },
      { name: 'その他', value: 9 },
    ],
  },
} satisfies Meta<typeof BarList>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Bars start at zero and are sorted by value; the unit goes with the number */
export const Default: Story = {
  render: (args) => (
    <div className="max-w-md">
      <BarList {...args} valueFormatter={(value) => `${value} 件`} />
    </div>
  ),
};
