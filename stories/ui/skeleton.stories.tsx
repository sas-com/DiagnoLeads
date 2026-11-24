import { Skeleton } from '@/components/ui/skeleton';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';

const meta = {
  title: '部品/Skeleton',
  component: Skeleton,
} satisfies Meta<typeof Skeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The shape of what is loading; say "読み込み中" to screen readers on the region around it */
export const Default: Story = {
  render: () => (
    <output aria-label="読み込み中" className="block max-w-md space-y-3">
      <Skeleton className="h-6 w-40" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-5/6" />
      <Skeleton className="h-24 w-full" />
    </output>
  ),
};
