import { Card } from '@/components/ui/card';
import { Divider, Metric, Text, Title } from '@/components/ui/metric';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';

const meta = {
  title: '部品/Metric',
  component: Metric,
  args: { children: '128 件' },
} satisfies Meta<typeof Metric>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A number with its name above it; say what it counts and for which period */
export const Default: Story = {
  render: () => (
    <Card className="max-w-xs p-6">
      <Title>今月のリード</Title>
      <Metric>128 件</Metric>
      <Divider />
      <Text>2026年11月1日から今日まで</Text>
    </Card>
  ),
};
