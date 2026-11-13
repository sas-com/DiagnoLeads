import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';

const meta = {
  title: '部品/Checkbox',
  component: Checkbox,
} satisfies Meta<typeof Checkbox>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { 'aria-label': '選ぶ' } };

export const States: Story = {
  render: () => (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Checkbox id="story-check-off" />
        <Label htmlFor="story-check-off">選んでいない</Label>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox id="story-check-on" defaultChecked />
        <Label htmlFor="story-check-on">選んでいる</Label>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox id="story-check-disabled" disabled />
        <Label htmlFor="story-check-disabled">選べない</Label>
      </div>
    </div>
  ),
};
