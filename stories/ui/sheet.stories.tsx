import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';

const meta = {
  title: '部品/Sheet',
  component: Sheet,
} satisfies Meta<typeof Sheet>;

export default meta;
type Story = StoryObj<typeof meta>;

function Example({ defaultOpen = false }: { defaultOpen?: boolean }) {
  return (
    <Sheet defaultOpen={defaultOpen}>
      <SheetTrigger asChild>
        <Button variant="outline">詳細を開く</Button>
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>架空商事</SheetTitle>
          <SheetDescription>一覧を見たまま、1件の詳細を横に出します。</SheetDescription>
        </SheetHeader>
        <dl className="mt-6 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-base">
          <dt className="text-gray-600 dark:text-gray-300">状態</dt>
          <dd>連絡済み</dd>
          <dt className="text-gray-600 dark:text-gray-300">更新日</dt>
          <dd>2026年11月12日</dd>
        </dl>
      </SheetContent>
    </Sheet>
  );
}

/** A panel from the side for the details of one row, keeping the list behind it */
export const Default: Story = { render: () => <Example /> };

export const Open: Story = {
  tags: ['!autodocs'],
  render: () => (
    <div className="h-96">
      <Example defaultOpen />
    </div>
  ),
};
