import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';

const meta = {
  title: '部品/Select',
  component: Select,
} satisfies Meta<typeof Select>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <div className="max-w-xs space-y-2">
      <Label htmlFor="story-select">状態</Label>
      <Select defaultValue="contacted">
        <SelectTrigger id="story-select">
          <SelectValue placeholder="選んでください" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>進行中</SelectLabel>
            <SelectItem value="new">新規</SelectItem>
            <SelectItem value="contacted">連絡済み</SelectItem>
            <SelectItem value="meeting">商談中</SelectItem>
          </SelectGroup>
          <SelectGroup>
            <SelectLabel>終了</SelectLabel>
            <SelectItem value="won">受注</SelectItem>
            <SelectItem value="lost">失注</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  ),
};
