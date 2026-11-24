import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';

const meta = {
  title: '部品/AlertDialog',
  component: AlertDialog,
} satisfies Meta<typeof AlertDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

function Example({ defaultOpen = false }: { defaultOpen?: boolean }) {
  return (
    <AlertDialog defaultOpen={defaultOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="destructive">削除する</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>このリードを削除しますか</AlertDialogTitle>
          <AlertDialogDescription>連絡の記録も消え、元に戻せません。</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>キャンセル</AlertDialogCancel>
          <AlertDialogAction>削除する</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * For an action that cannot be undone: the title asks, the text says what is lost, and the
 * button names the action (never just "OK")
 */
export const Default: Story = { render: () => <Example /> };

export const Open: Story = {
  tags: ['!autodocs'],
  render: () => (
    <div className="h-80">
      <Example defaultOpen />
    </div>
  ),
};
