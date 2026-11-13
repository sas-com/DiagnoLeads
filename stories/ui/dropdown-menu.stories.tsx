import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { MoreHorizontal } from 'lucide-react';

const meta = {
  title: '部品/DropdownMenu',
  component: DropdownMenu,
} satisfies Meta<typeof DropdownMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The actions of one row; the action that cannot be undone comes last, after a separator */
export const Default: Story = {
  render: () => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" aria-label="操作">
          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>架空商事</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem>連絡を記録</DropdownMenuItem>
        <DropdownMenuItem>担当を変える</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-red-700 dark:text-red-300">削除する</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
};
