import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';

const meta = {
  title: '部品/Tabs',
  component: Tabs,
} satisfies Meta<typeof Tabs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Tabs defaultValue="overview" className="max-w-xl">
      <TabsList>
        <TabsTrigger value="overview">概要</TabsTrigger>
        <TabsTrigger value="activity">活動</TabsTrigger>
        <TabsTrigger value="deals">商談</TabsTrigger>
      </TabsList>
      <TabsContent value="overview" className="pt-4 text-base">
        リードの基本の情報と、次の行動を表示します。
      </TabsContent>
      <TabsContent value="activity" className="pt-4 text-base">
        連絡の記録を新しい順に表示します。
      </TabsContent>
      <TabsContent value="deals" className="pt-4 text-base">
        このリードの商談を表示します。
      </TabsContent>
    </Tabs>
  ),
};
