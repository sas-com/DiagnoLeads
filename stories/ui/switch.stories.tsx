import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';

const meta = {
  title: '部品/Switch',
  component: Switch,
} satisfies Meta<typeof Switch>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { 'aria-label': '通知を受け取る' } };

/** For a setting that takes effect at once; a choice sent with a form is a checkbox */
export const WithLabel: Story = {
  render: () => (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Switch id="story-switch-on" defaultChecked />
        <Label htmlFor="story-switch-on">期限の通知を受け取る</Label>
      </div>
      <div className="flex items-center gap-3">
        <Switch id="story-switch-off" />
        <Label htmlFor="story-switch-off">毎朝のまとめを受け取る</Label>
      </div>
      <div className="flex items-center gap-3">
        <Switch id="story-switch-disabled" disabled />
        <Label htmlFor="story-switch-disabled">変更できない設定</Label>
      </div>
    </div>
  ),
};
