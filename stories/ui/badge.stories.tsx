import { Badge } from '@/components/ui/badge';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';

const meta = {
  title: '部品/Badge',
  component: Badge,
  args: { children: '新規' },
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Variants: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Badge>新規</Badge>
      <Badge variant="secondary">下書き</Badge>
      <Badge variant="outline">保留</Badge>
      <Badge variant="destructive">期限切れ</Badge>
    </div>
  ),
};

/** The color says the kind; the words say the meaning (never the color alone) */
export const Colors: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Badge color="blue">連絡済み</Badge>
      <Badge color="yellow">要確認</Badge>
      <Badge color="emerald">受注</Badge>
      <Badge color="violet">商談中</Badge>
      <Badge color="amber">保留</Badge>
      <Badge color="gray">対象外</Badge>
    </div>
  ),
};

export const Sizes: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Badge size="sm">小</Badge>
      <Badge size="md">標準</Badge>
      <Badge size="lg">大</Badge>
    </div>
  ),
};
