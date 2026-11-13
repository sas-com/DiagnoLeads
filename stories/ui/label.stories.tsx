import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';

const meta = {
  title: '部品/Label',
  component: Label,
  args: { children: '表示名' },
} satisfies Meta<typeof Label>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithCheckbox: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <Checkbox id="story-label-check" />
      <Label htmlFor="story-label-check">完了したリードも表示する</Label>
    </div>
  ),
};
