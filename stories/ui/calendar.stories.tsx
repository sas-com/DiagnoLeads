import { Calendar } from '@/components/ui/calendar';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useState } from 'react';

const meta = {
  title: '部品/Calendar',
  component: Calendar,
} satisfies Meta<typeof Calendar>;

export default meta;
type Story = StoryObj<typeof meta>;

function Example() {
  const [date, setDate] = useState<Date | undefined>(new Date(2026, 10, 13));
  return (
    <Calendar
      mode="single"
      selected={date}
      onSelect={setDate}
      defaultMonth={new Date(2026, 10, 1)}
      className="w-fit rounded-md border border-gray-300 dark:border-gray-600"
    />
  );
}

/** Picking one day; a date typed by hand should also be possible next to it */
export const Default: Story = { render: () => <Example /> };
