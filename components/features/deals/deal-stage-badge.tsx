'use client';

import { Badge, type BadgeProps } from '@/components/ui/badge';
import type { DealStage } from '@/lib/features/deals/types/pipeline';
import { XCircle } from 'lucide-react';
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

/**
 * A deal's stage. A lost deal's badge has an icon as well (Refs #720): it shares its grey with
 * the first stage, so the two do not differ in colour only.
 */
export function DealStageBadge({ stage }: { stage: DealStage }) {
  const t = useTranslations('deals.stages');
  return (
    <Badge color={STAGE_COLORS[stage]} className="gap-1 text-sm">
      {stage === 'lost' && <XCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
      {t(stage)}
    </Badge>
  );
}
