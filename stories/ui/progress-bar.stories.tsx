import { CategoryBar, DeltaBar, ProgressBar } from '@/components/ui/progress-bar';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';

const meta = {
  title: '部品/ProgressBar',
  component: ProgressBar,
  args: { value: 64 },
} satisfies Meta<typeof ProgressBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <div className="max-w-md space-y-2">
      <p className="text-base text-gray-900 dark:text-gray-50">目標の 64%</p>
      <ProgressBar {...args} />
    </div>
  ),
};

/** The key color first; other colors only when the bars mean different things */
export const Colors: Story = {
  render: () => (
    <div className="max-w-md space-y-3">
      <ProgressBar value={80} color="brand" />
      <ProgressBar value={55} color="blue" />
      <ProgressBar value={30} color="amber" />
      <ProgressBar value={12} color="red" />
    </div>
  ),
};

export const Category: Story = {
  render: () => (
    <div className="max-w-md space-y-2">
      <p className="text-base text-gray-900 dark:text-gray-50">
        段階ごとの割合（新規・連絡済み・商談中）
      </p>
      <CategoryBar values={[50, 30, 20]} colors={['brand', 'blue', 'amber']} markerValue={62} />
    </div>
  ),
};

export const Delta: Story = {
  render: () => (
    <div className="max-w-md space-y-3">
      <DeltaBar value={35} />
      <DeltaBar value={-20} />
    </div>
  ),
};
