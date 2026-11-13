import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';

const meta = {
  title: '部品/RadioGroup',
  component: RadioGroup,
} satisfies Meta<typeof RadioGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <RadioGroup defaultValue="call" aria-label="連絡の種類" className="space-y-2">
      <div className="flex items-center gap-2">
        <RadioGroupItem value="call" id="story-radio-call" />
        <Label htmlFor="story-radio-call">電話</Label>
      </div>
      <div className="flex items-center gap-2">
        <RadioGroupItem value="email" id="story-radio-email" />
        <Label htmlFor="story-radio-email">メール</Label>
      </div>
      <div className="flex items-center gap-2">
        <RadioGroupItem value="visit" id="story-radio-visit" />
        <Label htmlFor="story-radio-visit">訪問</Label>
      </div>
    </RadioGroup>
  ),
};
