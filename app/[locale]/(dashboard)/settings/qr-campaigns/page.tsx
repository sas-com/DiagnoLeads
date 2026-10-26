'use client';

import { QrCampaignDestinationNotice } from '@/components/features/distribution/qr-campaign-destination';
import { QrCampaignExpiry } from '@/components/features/distribution/qr-campaign-expiry';
import {
  QrCampaignResults,
  type QrCampaignResultsBreakdown,
} from '@/components/features/distribution/qr-campaign-results';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useOrganization } from '@/hooks/use-organization';
import { inferInflowSource } from '@/lib/features/diagnostics/tracking';
import { expiryOfChosenDay, jstDayOf } from '@/lib/features/distribution/campaign-expiry';
import {
  DEFAULT_QR_CAMPAIGN_MEDIUM,
  QR_CAMPAIGN_MEDIUMS,
  type QrCampaignMedium,
} from '@/lib/features/distribution/types';
import { trpc } from '@/lib/trpc/client';
import {
  AlertCircle,
  Check,
  Copy,
  Download,
  Info,
  Loader2,
  MoreVertical,
  Plus,
  QrCode,
  Trash2,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { toast } from 'sonner';

interface QRCampaignFormData {
  name: string;
  description: string;
  diagnosticTemplateId: string;
  utmSource: string;
  /** Where the code is handed out: one of the list, never typed (#788) */
  utmMedium: QrCampaignMedium;
  utmCampaign: string;
  utmContent: string;
  /** The last day in Japan the campaign is open ('YYYY-MM-DD'), or '' for no expiry (#695) */
  expiresOn: string;
}

/** The breakdown of a campaign no answer with its code has reached yet */
const NO_ANSWERS: QrCampaignResultsBreakdown = {
  existingLeadAnswers: 0,
  interestedNewLeads: 0,
  consultationNewLeads: 0,
};

const DEFAULT_FORM_DATA: QRCampaignFormData = {
  name: '',
  description: '',
  diagnosticTemplateId: '',
  utmSource: 'qrcode',
  utmMedium: DEFAULT_QR_CAMPAIGN_MEDIUM,
  utmCampaign: '',
  utmContent: '',
  expiresOn: '',
};

export default function QRCampaignsPage() {
  const t = useTranslations('settings.qrCampaigns');
  const tExpiry = useTranslations('settings.qrCampaigns.expiry');
  const tMedium = useTranslations('settings.qrCampaigns.medium');
  const tPipeline = useTranslations('pipeline');
  const { organization } = useOrganization();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [formData, setFormData] = useState<QRCampaignFormData>(DEFAULT_FORM_DATA);
  const nameHintId = useId();
  const mediumHintId = useId();
  const copyUrlHintId = useId();

  const utils = trpc.useUtils();

  // Fetch QR campaigns
  const { data: campaigns, isLoading } = trpc.distribution.listCampaigns.useQuery(
    { organizationId: organization?.id ?? '' },
    { enabled: !!organization?.id }
  );

  // What the answers with each campaign's code add (#700): counted by analytics over the answers
  // and the leads, for every campaign of the organization in one query, and shown beside the
  // campaign's own counts (distribution imports no other feature)
  const { data: breakdowns, isError: breakdownFailed } =
    trpc.analytics.getQrCampaignBreakdown.useQuery(
      { organizationId: organization?.id ?? '' },
      { enabled: !!organization?.id }
    );
  const breakdownById = new Map(breakdowns?.map((row) => [row.campaignId, row]));
  // Said while it loads and when it could not be read; a campaign no answer with its code has
  // reached has zeros
  const breakdownOf = (
    campaignId: string
  ): QrCampaignResultsBreakdown | 'loading' | 'unavailable' => {
    if (breakdowns) return breakdownById.get(campaignId) ?? NO_ANSWERS;
    return breakdownFailed ? 'unavailable' : 'loading';
  };

  // Only those who can update settings may change campaigns (#356)
  const { data: canManage = false } = trpc.distribution.canManage.useQuery(
    { organizationId: organization?.id ?? '' },
    { enabled: !!organization?.id }
  );

  // Fetch diagnostic templates for selection
  const { data: templates } = trpc.diagnosticTemplates.list.useQuery(
    { organizationId: organization?.id ?? '' },
    { enabled: !!organization?.id }
  );

  // Create mutation
  const createMutation = trpc.distribution.createCampaign.useMutation({
    onSuccess: () => {
      toast.success('QR Campaign created successfully');
      utils.distribution.listCampaigns.invalidate();
      setIsCreateOpen(false);
      setFormData(DEFAULT_FORM_DATA);
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to create campaign');
    },
  });

  // Update mutation
  const updateMutation = trpc.distribution.updateCampaign.useMutation({
    onSuccess: () => {
      toast.success('Campaign updated');
      utils.distribution.listCampaigns.invalidate();
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to update campaign');
    },
  });

  // Delete mutation
  const deleteMutation = trpc.distribution.deleteCampaign.useMutation({
    onSuccess: () => {
      toast.success('Campaign deleted');
      utils.distribution.listCampaigns.invalidate();
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to delete campaign');
    },
  });

  // Generate QR mutation for campaign
  const generateQRMutation = trpc.distribution.generateCampaignQR.useMutation({
    onSuccess: (data) => {
      // Download QR code as PNG
      const link = document.createElement('a');
      link.href = data.qrCode;
      link.download = `qr-${data.shortCode}.png`;
      link.click();
      toast.success('QR Code downloaded');
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to generate QR code');
    },
  });

  // The 流入元 the new leads of the chosen medium get, by the rule of the answers (#788)
  const mediumInflow = inferInflowSource({ utmMedium: formData.utmMedium }).inflowSource;

  const handleCreate = () => {
    if (!organization?.id || !formData.name || !formData.diagnosticTemplateId) {
      toast.error('Please fill in all required fields');
      return;
    }

    // The end of the chosen day in Japan, not a day already over; none when the field is empty (#695)
    const { expiresOn, ...fields } = formData;
    const chosen = expiresOn ? expiryOfChosenDay(expiresOn, new Date()) : undefined;
    if (chosen && 'problem' in chosen) {
      toast.error(tExpiry(chosen.problem === 'past_day' ? 'pastDay' : 'invalidDay'));
      return;
    }

    createMutation.mutate({
      organizationId: organization.id,
      ...fields,
      ...(chosen ? { expiresAt: chosen.expiresAt } : {}),
    });
  };

  const handleToggleActive = (campaignId: string, isActive: boolean) => {
    if (!organization?.id) return;
    updateMutation.mutate({
      organizationId: organization.id,
      id: campaignId,
      data: { isActive: !isActive },
    });
  };

  const handleDelete = (campaignId: string) => {
    if (!organization?.id) return;
    if (!window.confirm('Are you sure you want to delete this campaign?')) return;
    deleteMutation.mutate({
      organizationId: organization.id,
      id: campaignId,
    });
  };

  const handleDownloadQR = (campaignId: string) => {
    if (!organization?.id) return;
    generateQRMutation.mutate({
      organizationId: organization.id,
      campaignId,
      size: 'large',
    });
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">QR Code Campaigns</h1>
          <p className="text-muted-foreground">
            Create and manage QR codes for offline distribution
          </p>
        </div>
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          {canManage && (
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                New Campaign
              </Button>
            </DialogTrigger>
          )}
          {/* Scrolls inside the window: the form is taller than a phone's screen */}
          <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Create QR Campaign</DialogTitle>
              {/* The note is part of the description, so it is read when the dialog opens */}
              <DialogDescription asChild>
                <div className="space-y-3">
                  <p>Create a new QR code campaign for offline distribution</p>
                  {/* Checks count too (#700, marketing review): check with a campaign of its own */}
                  <Callout
                    title={t('testFirstTitle')}
                    icon={Info}
                    color="blue"
                    className="text-left"
                  >
                    {t('testFirst')}
                  </Callout>
                </div>
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              {/* Campaign Name */}
              <div className="grid gap-2">
                <Label htmlFor="name">Campaign Name *</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder={t('namePlaceholder')}
                  aria-describedby={nameHintId}
                />
                <p id={nameHintId} className="text-xs text-muted-foreground">
                  {t('nameHint')}
                </p>
              </div>

              {/* Description */}
              <div className="grid gap-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Describe the campaign purpose..."
                />
              </div>

              {/* Diagnostic Template */}
              <div className="grid gap-2">
                <Label htmlFor="template">Diagnostic Template *</Label>
                <Select
                  value={formData.diagnosticTemplateId}
                  onValueChange={(value) =>
                    setFormData({ ...formData, diagnosticTemplateId: value })
                  }
                >
                  <SelectTrigger id="template">
                    <SelectValue placeholder="Select a template" />
                  </SelectTrigger>
                  <SelectContent>
                    {templates?.map((template) => (
                      <SelectItem key={template.id} value={template.id}>
                        {template.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Where the code is handed out: the campaign's utm_medium, chosen from the media
                  that map to a 流入元, which is said under it (#788) */}
              <div className="grid gap-2">
                <Label htmlFor="utmMedium">{tMedium('label')}</Label>
                <Select
                  value={formData.utmMedium}
                  onValueChange={(value) => {
                    const medium = QR_CAMPAIGN_MEDIUMS.find((option) => option === value);
                    if (medium) setFormData({ ...formData, utmMedium: medium });
                  }}
                >
                  <SelectTrigger
                    id="utmMedium"
                    aria-describedby={mediumInflow ? mediumHintId : undefined}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {QR_CAMPAIGN_MEDIUMS.map((medium) => (
                      <SelectItem key={medium} value={medium}>
                        {tMedium(`options.${medium}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {mediumInflow && (
                  <p id={mediumHintId} className="text-xs text-muted-foreground">
                    {tMedium('inflow', { source: tPipeline(`inflowSource.${mediumInflow}`) })}
                  </p>
                )}
              </div>

              {/* UTM Parameters */}
              <div className="space-y-3">
                <Label>UTM Parameters</Label>
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-1">
                    <Label htmlFor="utmSource" className="text-xs text-muted-foreground">
                      Source
                    </Label>
                    <Input
                      id="utmSource"
                      value={formData.utmSource}
                      onChange={(e) => setFormData({ ...formData, utmSource: e.target.value })}
                      placeholder="qrcode"
                    />
                  </div>
                  <div className="grid gap-1">
                    <Label htmlFor="utmCampaign" className="text-xs text-muted-foreground">
                      Campaign
                    </Label>
                    <Input
                      id="utmCampaign"
                      value={formData.utmCampaign}
                      onChange={(e) => setFormData({ ...formData, utmCampaign: e.target.value })}
                      placeholder="2026-11-dx-expo"
                    />
                  </div>
                  <div className="grid gap-1">
                    <Label htmlFor="utmContent" className="text-xs text-muted-foreground">
                      Content
                    </Label>
                    <Input
                      id="utmContent"
                      value={formData.utmContent}
                      onChange={(e) => setFormData({ ...formData, utmContent: e.target.value })}
                      placeholder="booth-banner"
                    />
                  </div>
                </div>
              </div>

              {/* Expiry (#695) */}
              <div className="grid gap-2">
                <Label htmlFor="expiresOn">{tExpiry('createLabel')}</Label>
                <Input
                  id="expiresOn"
                  type="date"
                  min={jstDayOf(new Date())}
                  value={formData.expiresOn}
                  onChange={(e) => setFormData({ ...formData, expiresOn: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">{tExpiry('createHint')}</p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleCreate}
                disabled={
                  createMutation.isPending || !formData.name || !formData.diagnosticTemplateId
                }
              >
                {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create Campaign
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Campaigns Grid */}
      {campaigns && campaigns.length > 0 ? (
        // Three columns only from xl: with the sidebar, a card at lg is too narrow for its notes
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {campaigns.map((campaign) => (
            // A paused campaign is marked, not faded: its counts still grow and are read
            <Card key={campaign.id} className="flex flex-col">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex flex-wrap items-center gap-2">
                    <QrCode className="h-5 w-5 text-primary" />
                    <CardTitle className="text-lg">{campaign.name}</CardTitle>
                    {!campaign.isActive && (
                      <Badge variant="secondary">{t('destination.reasons.paused.title')}</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      aria-label={t('active')}
                      checked={campaign.isActive}
                      disabled={!canManage}
                      onCheckedChange={() => handleToggleActive(campaign.id, campaign.isActive)}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive"
                      hidden={!canManage}
                      onClick={() => handleDelete(campaign.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                {campaign.description && (
                  <CardDescription className="mt-1">{campaign.description}</CardDescription>
                )}
              </CardHeader>
              <CardContent className="flex flex-1 flex-col space-y-4">
                {/* Where a scan goes and the expiry, decided on the server by the entry's rule (#692, #695) */}
                <QrCampaignDestinationNotice destination={campaign.destination} />
                <QrCampaignExpiry
                  organizationId={organization?.id ?? ''}
                  campaignId={campaign.id}
                  expiresAt={campaign.expiresAt}
                  expired={
                    campaign.destination.kind === 'none' &&
                    campaign.destination.reasons.includes('expired')
                  }
                  canManage={canManage}
                />

                {/* Scans, new leads and their rate from the campaign row; the breakdown from the answers (#700) */}
                <QrCampaignResults
                  scanCount={campaign.scanCount}
                  completionCount={campaign.completionCount}
                  createdAt={campaign.createdAt}
                  breakdown={breakdownOf(campaign.id)}
                />

                {/* The code and the actions at the bottom, lined up across the cards of a row */}
                <div className="mt-auto space-y-4">
                  {/* Short Code */}
                  <div className="flex items-center gap-2">
                    <code className="flex-1 rounded bg-muted px-2 py-1 text-xs">
                      {campaign.shortCode}
                    </code>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      aria-label={t('copyUrl')}
                      aria-describedby={`${copyUrlHintId}-${campaign.id}`}
                      onClick={() => copyToClipboard(campaign.trackingUrl)}
                    >
                      <Copy className="h-3 w-3" aria-hidden="true" />
                    </Button>
                  </div>

                  {/* Actions */}
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1"
                        onClick={() => handleDownloadQR(campaign.id)}
                        disabled={generateQRMutation.isPending}
                      >
                        {generateQRMutation.isPending ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Download className="mr-2 h-4 w-4" />
                        )}
                        {t('downloadQR')}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        aria-describedby={`${copyUrlHintId}-${campaign.id}`}
                        onClick={() => copyToClipboard(campaign.trackingUrl)}
                      >
                        <Copy className="mr-2 h-4 w-4" />
                        {t('copyUrl')}
                      </Button>
                    </div>
                    {/* Opening the URL counts as a scan; one campaign per channel, so each one's
                        counts stay its own (#700, marketing review) */}
                    <p
                      id={`${copyUrlHintId}-${campaign.id}`}
                      className="text-xs text-muted-foreground"
                    >
                      {t('copyUrlHint')}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        /* Empty State */
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <QrCode className="h-16 w-16 text-muted-foreground/50" />
            <h3 className="mt-4 text-lg font-medium">No QR Campaigns</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Create your first QR code campaign for offline distribution
            </p>
            <Button className="mt-4" hidden={!canManage} onClick={() => setIsCreateOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Create Campaign
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
