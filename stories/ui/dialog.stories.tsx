import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';

const meta = {
  title: '部品/Dialog',
  component: Dialog,
} satisfies Meta<typeof Dialog>;

export default meta;
type Story = StoryObj<typeof meta>;

function Example({ defaultOpen = false }: { defaultOpen?: boolean }) {
  return (
    <Dialog defaultOpen={defaultOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">名前を変える</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>表示名を変える</DialogTitle>
          <DialogDescription>一覧と通知に出る名前です。40文字まで。</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="story-dialog-name">表示名</Label>
          <Input id="story-dialog-name" defaultValue="AIセールス" />
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">キャンセル</Button>
          </DialogClose>
          <Button>保存する</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Opens from the button; the focus moves in, Esc closes, and the focus returns to the button */
export const Default: Story = { render: () => <Example /> };

export const Open: Story = {
  tags: ['!autodocs'],
  render: () => (
    <div className="h-96">
      <Example defaultOpen />
    </div>
  ),
};
