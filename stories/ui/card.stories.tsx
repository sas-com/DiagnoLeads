import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';

const meta = {
  title: '部品/Card',
  component: Card,
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Card className="max-w-md">
      <CardHeader>
        <CardTitle>今月の商談</CardTitle>
        <CardDescription>2026年11月1日から今日まで</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-bold tabular-nums">12 件</p>
        <p className="text-sm text-gray-700 dark:text-gray-200">先月の同じ日までは 9 件</p>
      </CardContent>
      <CardFooter>
        <Button variant="outline">商談を見る</Button>
      </CardFooter>
    </Card>
  ),
};
