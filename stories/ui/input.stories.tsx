import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';

const meta = {
  title: '部品/Input',
  component: Input,
  args: { placeholder: '例：架空商事' },
} satisfies Meta<typeof Input>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { 'aria-label': '会社名' } };

/** Always with a visible label; the hint is tied to the field with aria-describedby */
export const WithLabel: Story = {
  render: () => (
    <div className="max-w-sm space-y-2">
      <Label htmlFor="story-company">会社名</Label>
      <Input id="story-company" placeholder="例：架空商事" aria-describedby="story-company-hint" />
      <p id="story-company-hint" className="text-sm text-gray-700 dark:text-gray-200">
        100文字まで
      </p>
    </div>
  ),
};

export const Invalid: Story = {
  render: () => (
    <div className="max-w-sm space-y-2">
      <Label htmlFor="story-email">メールアドレス</Label>
      <Input
        id="story-email"
        defaultValue="sample@"
        aria-invalid="true"
        aria-describedby="story-email-error"
      />
      <p id="story-email-error" className="text-sm font-bold text-red-700 dark:text-red-300">
        メールアドレスの形で入力してください
      </p>
    </div>
  ),
};

export const Disabled: Story = { args: { disabled: true, 'aria-label': '会社名' } };
