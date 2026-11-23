import { Callout } from '@/components/ui/callout';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';

const meta = {
  title: '部品/Callout',
  component: Callout,
  args: { title: 'この役割の AI社員はまだいません。' },
} satisfies Meta<typeof Callout>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** The icon and the words carry the meaning along with the color */
export const Colors: Story = {
  render: () => (
    <div className="max-w-xl space-y-4">
      <Callout color="blue" icon={Info} title="お知らせ">
        取り込みは1,000件ずつ送ります。
      </Callout>
      <Callout color="yellow" icon={AlertTriangle} title="注意">
        次の行動の期限が近いリードが3件あります。
      </Callout>
      <Callout color="red" icon={XCircle} title="エラー">
        保存できませんでした。時間をおいて、もう一度お試しください。
      </Callout>
      <Callout color="green" icon={CheckCircle2} title="完了">
        12件を取り込みました。
      </Callout>
    </div>
  ),
};
