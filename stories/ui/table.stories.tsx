import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';

const ROWS = [
  { company: '架空商事', status: '連絡済み', score: 82, updated: '2026年11月12日' },
  { company: 'サンプル工業', status: '商談中', score: 74, updated: '2026年11月10日' },
  { company: '見本物産', status: '新規', score: 51, updated: '2026年11月09日' },
] as const;

const meta = {
  title: '部品/Table',
  component: Table,
} satisfies Meta<typeof Table>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Numbers are right-aligned with tabular-nums; the caption says what the table lists */
export const Default: Story = {
  render: () => (
    <Table>
      <TableCaption>新しい順に3件（会社名は架空のものです）</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>会社名</TableHead>
          <TableHead>状態</TableHead>
          <TableHead className="text-right">点数</TableHead>
          <TableHead>更新日</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {ROWS.map((row) => (
          <TableRow key={row.company}>
            <TableCell className="font-bold">{row.company}</TableCell>
            <TableCell>
              <Badge variant="outline">{row.status}</Badge>
            </TableCell>
            <TableCell className="text-right tabular-nums">{row.score}</TableCell>
            <TableCell>{row.updated}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  ),
};
