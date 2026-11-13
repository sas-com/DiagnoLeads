import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';

const meta = {
  title: '部品/Command',
  component: Command,
} satisfies Meta<typeof Command>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A list to search and pick from: typing narrows it, the arrow keys move, Enter chooses */
export const Default: Story = {
  render: () => (
    <Command className="max-w-sm rounded-lg border border-gray-300 dark:border-gray-600">
      <CommandInput placeholder="担当者を探す" />
      <CommandList>
        <CommandEmpty>見つかりません</CommandEmpty>
        <CommandGroup heading="営業">
          <CommandItem>担当 A</CommandItem>
          <CommandItem>担当 B</CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="そのほか">
          <CommandItem>担当なし</CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  ),
};
