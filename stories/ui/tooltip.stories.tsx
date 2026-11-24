import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Download } from 'lucide-react';

const meta = {
  title: '部品/Tooltip',
  component: Tooltip,
} satisfies Meta<typeof Tooltip>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * A short name for a control that shows only an icon. What people must read to use the screen
 * goes on the screen itself, not in a tooltip (it does not open on touch)
 */
export const Default: Story = {
  render: () => (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="outline" size="icon" aria-label="CSV で書き出す">
            <Download className="h-4 w-4" aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>CSV で書き出す</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  ),
};
