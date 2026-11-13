import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';

const meta = {
  title: '部品/Textarea',
  component: Textarea,
  args: { placeholder: '打ち合わせで分かったことを書く' },
} satisfies Meta<typeof Textarea>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { 'aria-label': 'メモ' } };

export const WithLabel: Story = {
  render: () => (
    <div className="max-w-md space-y-2">
      <Label htmlFor="story-note">メモ</Label>
      <Textarea id="story-note" rows={4} placeholder="打ち合わせで分かったことを書く" />
    </div>
  ),
};

export const Disabled: Story = { args: { disabled: true, 'aria-label': 'メモ' } };
