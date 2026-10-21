import type { RouterOutputs } from '@/lib/trpc/client';

export type ProspectList = RouterOutputs['prospects']['list'];
export type ProspectRow = ProspectList['prospects'][number];
export type ProspectSummaryData = RouterOutputs['prospects']['summary'];
