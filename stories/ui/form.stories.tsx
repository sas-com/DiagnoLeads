import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { zodResolver } from '@hookform/resolvers/zod';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

const schema = z.object({
  name: z
    .string()
    .trim()
    .min(1, '表示名を入力してください')
    .max(40, '40文字までで入力してください'),
});

function Example() {
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { name: '' },
  });
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(() => undefined)} className="max-w-sm space-y-4" noValidate>
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>表示名</FormLabel>
              <FormControl>
                <Input placeholder="例：AIセールス" {...field} />
              </FormControl>
              <FormDescription>一覧と通知に出る名前です。40文字まで。</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit">保存する</Button>
      </form>
    </Form>
  );
}

const meta = {
  title: '部品/Form',
  component: Example,
} satisfies Meta<typeof Example>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * A field with its label, hint and error tied together (react-hook-form and zod). Press the
 * button with the field empty to see the error
 */
export const Default: Story = {};
