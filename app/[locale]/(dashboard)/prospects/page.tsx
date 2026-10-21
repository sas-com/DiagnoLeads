'use client';

import { ProspectsList } from '@/components/features/prospects/prospects-list';
import { ProspectsSummary } from '@/components/features/prospects/prospects-summary';
import { ReferralLinkCard } from '@/components/features/prospects/referral-link-card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useOrganization } from '@/hooks/use-organization';
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

/** The AX customer search list and its summary (#265) */
export default function ProspectsPage() {
  const t = useTranslations('prospects');
  const { organization } = useOrganization();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground">{t('description')}</p>
      </div>
      {organization ? (
        <div className="space-y-6">
          <ReferralLinkCard organizationId={organization.id} />
          <Tabs defaultValue="list">
            <TabsList>
              <TabsTrigger value="list">{t('tabs.list')}</TabsTrigger>
              <TabsTrigger value="summary">{t('tabs.summary')}</TabsTrigger>
            </TabsList>
            <TabsContent value="list" className="mt-4">
              <ProspectsList organizationId={organization.id} />
            </TabsContent>
            <TabsContent value="summary" className="mt-4">
              <ProspectsSummary organizationId={organization.id} />
            </TabsContent>
          </Tabs>
        </div>
      ) : (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
        </div>
      )}
    </div>
  );
}
