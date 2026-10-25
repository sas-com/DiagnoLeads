'use client';

import { Badge, type BadgeProps } from '@/components/ui/badge';
import type { DealStage } from '@/lib/features/deals/types/pipeline';
import { useTranslations } from 'next-intl';

/** Colours only repeat the stage name, never replace it */
const STAGE_COLORS: Record<DealStage, NonNullable<BadgeProps['color']>> = {
  qualification: 'gray',
  discovery: 'blue',
  proposal: 'violet',
  negotiation: 'amber',
  won: 'emerald',
  lost: 'gray',
};

export function DealStageBadge({ stage }: { stage: DealStage }) {
  const t = useTranslations('deals.stages');
  return <Badge color={STAGE_COLORS[stage]}>{t(stage)}</Badge>;
}
