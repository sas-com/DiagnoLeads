import { Button } from '@/components/ui/button';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Plus, Trash2 } from 'lucide-react';

const meta = {
  title: '部品/Button',
  component: Button,
  args: { children: '保存する' },
  argTypes: {
    variant: {
      control: 'select',
      options: ['default', 'outline', 'secondary', 'ghost', 'link', 'destructive'],
    },
    size: { control: 'select', options: ['default', 'sm', 'lg', 'icon'] },
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The filled button: one per screen as a rule (the main action) */
export const Default: Story = {};

export const Variants: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button>保存する</Button>
      <Button variant="outline">キャンセル</Button>
      <Button variant="secondary">下書きに戻す</Button>
      <Button variant="ghost">閉じる</Button>
      <Button variant="link">詳細を見る</Button>
      <Button variant="destructive">削除する</Button>
    </div>
  ),
};

export const Sizes: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button size="sm">小（36px）</Button>
      <Button>標準（40px）</Button>
      <Button size="lg">大（44px）</Button>
      <Button size="icon" aria-label="追加する">
        <Plus className="h-4 w-4" aria-hidden="true" />
      </Button>
    </div>
  ),
};

export const WithIcon: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button>
        <Plus className="h-4 w-4" aria-hidden="true" />
        リードを追加
      </Button>
      <Button variant="destructive">
        <Trash2 className="h-4 w-4" aria-hidden="true" />
        削除する
      </Button>
    </div>
  ),
};

export const Disabled: Story = { args: { disabled: true } };
