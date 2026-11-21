import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';

const meta = {
  title: '部品/ToggleGroup',
  component: ToggleGroup,
  args: { type: 'single' },
} satisfies Meta<typeof ToggleGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

/** One of a few choices that changes the view at once (a period, a way to group) */
export const Single: Story = {
  render: () => (
    <ToggleGroup type="single" defaultValue="month" aria-label="期間">
      <ToggleGroupItem value="week">週</ToggleGroupItem>
      <ToggleGroupItem value="month">月</ToggleGroupItem>
      <ToggleGroupItem value="quarter">四半期</ToggleGroupItem>
    </ToggleGroup>
  ),
};

export const Outline: Story = {
  args: { type: 'multiple' },
  render: () => (
    <ToggleGroup type="multiple" variant="outline" defaultValue={['call']} aria-label="連絡の種類">
      <ToggleGroupItem value="call">電話</ToggleGroupItem>
      <ToggleGroupItem value="email">メール</ToggleGroupItem>
      <ToggleGroupItem value="visit">訪問</ToggleGroupItem>
    </ToggleGroup>
  ),
};
