'use client';

import {
  type WebhookHeaderRow,
  WebhookHeadersEditor,
  hasDuplicateNames,
  isRowComplete,
  keepsStoredValue,
  rowsFromMaskedHeaders,
  rowsToHeaderInput,
  rowsToNewHeaders,
} from '@/components/features/webhooks/webhook-headers-editor';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
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
import { useOrganization } from '@/hooks/use-organization';
import {
  WEBHOOK_HEADER_MASK,
  isUrlChanged,
} from '@/lib/features/webhooks/services/webhook-headers';
import { trpc } from '@/lib/trpc/client';
import {
  Activity,
  AlertCircle,
  Check,
  Copy,
  Edit,
  ExternalLink,
  Loader2,
  Lock,
  MoreVertical,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  Webhook,
  X,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

// Webhook event types - must match WebhookEventType in lib/db/schema.ts
const WEBHOOK_EVENTS = [
  { value: 'lead.created', label: 'Lead Created', category: 'Leads' },
  { value: 'lead.updated', label: 'Lead Updated', category: 'Leads' },
  { value: 'lead.deleted', label: 'Lead Deleted', category: 'Leads' },
  { value: 'lead.status_changed', label: 'Lead Status Changed', category: 'Leads' },
  { value: 'lead.scored', label: 'Lead Scored', category: 'Leads' },
  { value: 'diagnostic.submitted', label: 'Diagnostic Submitted', category: 'Diagnostic' },
  { value: 'diagnostic.completed', label: 'Diagnostic Completed', category: 'Diagnostic' },
  { value: 'organization.member_added', label: 'Member Added', category: 'Organization' },
  { value: 'organization.member_removed', label: 'Member Removed', category: 'Organization' },
  { value: 'blog.published', label: 'Blog Published', category: 'Content' },
  { value: 'faq.published', label: 'FAQ Published', category: 'Content' },
] as const;

type WebhookEvent = (typeof WEBHOOK_EVENTS)[number]['value'];

interface WebhookFormData {
  name: string;
  url: string;
  events: WebhookEvent[];
  headers: WebhookHeaderRow[];
  /** The URL as saved (edit only) */
  savedUrl?: string;
}

const EMPTY_FORM: WebhookFormData = { name: '', url: '', events: [], headers: [] };

/**
 * The URL changes (host, path or anything else) while a stored header value would be kept: the
 * server refuses this (the receiver's credentials must not follow the webhook elsewhere), so
 * every value must be entered again or the header removed
 */
const isReentryRequired = (form: WebhookFormData) =>
  form.savedUrl !== undefined &&
  isUrlChanged(form.savedUrl, form.url) &&
  keepsStoredValue(form.headers);

const isFormComplete = (form: WebhookFormData) =>
  form.name !== '' &&
  form.url !== '' &&
  form.events.length > 0 &&
  form.headers.every(isRowComplete) &&
  !hasDuplicateNames(form.headers) &&
  !isReentryRequired(form);

const EVENTS_BY_CATEGORY = Object.entries(
  WEBHOOK_EVENTS.reduce(
    (acc, event) => {
      if (!acc[event.category]) acc[event.category] = [];
      acc[event.category].push(event);
      return acc;
    },
    {} as Record<string, (typeof WEBHOOK_EVENTS)[number][]>
  )
);

/** Name, URL, events and custom headers: shared by the create and edit dialogs */
function WebhookFormFields({
  form,
  onChange,
}: {
  form: WebhookFormData;
  onChange: (update: (prev: WebhookFormData) => WebhookFormData) => void;
}) {
  const t = useTranslations('settings.webhooks');

  const handleToggleEvent = (event: WebhookEvent) => {
    onChange((prev) => ({
      ...prev,
      events: prev.events.includes(event)
        ? prev.events.filter((e) => e !== event)
        : [...prev.events, event],
    }));
  };

  return (
    <div className="grid gap-4 py-4">
      <div className="grid gap-2">
        <Label htmlFor="name">{t('name')}</Label>
        <Input
          id="name"
          value={form.name}
          onChange={(e) => onChange((prev) => ({ ...prev, name: e.target.value }))}
          placeholder={t('namePlaceholder')}
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="url">{t('url')}</Label>
        <Input
          id="url"
          type="url"
          value={form.url}
          onChange={(e) => onChange((prev) => ({ ...prev, url: e.target.value }))}
          placeholder="https://example.com/webhook"
        />
      </div>

      <div className="grid gap-2">
        <Label>{t('events')}</Label>
        <div className="rounded-lg border p-4 max-h-64 overflow-y-auto">
          {EVENTS_BY_CATEGORY.map(([category, events]) => (
            <div key={category} className="mb-4 last:mb-0">
              <h4 className="text-sm font-medium text-muted-foreground mb-2">{category}</h4>
              <div className="space-y-2">
                {events.map((event) => (
                  // biome-ignore lint/a11y/noLabelWithoutControl: wraps the shadcn Checkbox (a Radix button), which Biome cannot detect as a control
                  <label key={event.value} className="flex items-center gap-2 cursor-pointer">
                    <Checkbox
                      checked={form.events.includes(event.value)}
                      onCheckedChange={() => handleToggleEvent(event.value)}
                    />
                    <span className="text-sm">{event.label}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <WebhookHeadersEditor
        rows={form.headers}
        onChange={(headers) => onChange((prev) => ({ ...prev, headers }))}
        reentryRequired={isReentryRequired(form)}
      />
    </div>
  );
}

export default function WebhooksSettingsPage() {
  const t = useTranslations('settings.webhooks');
  const { organization } = useOrganization();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingWebhook, setEditingWebhook] = useState<string | null>(null);
  const [formData, setFormData] = useState<WebhookFormData>(EMPTY_FORM);
  const [editForm, setEditForm] = useState<WebhookFormData>(EMPTY_FORM);
  const [showSecret, setShowSecret] = useState<string | null>(null);

  const utils = trpc.useUtils();

  // Fetch webhooks
  const {
    data: webhooks,
    isLoading,
    error,
  } = trpc.webhooks.list.useQuery(
    { organizationId: organization?.id ?? '' },
    { enabled: !!organization?.id }
  );
  const canCreate = webhooks?.permissions.canCreate ?? false;
  const canUpdate = webhooks?.permissions.canUpdate ?? false;
  const canDelete = webhooks?.permissions.canDelete ?? false;

  // Mutations
  const createWebhook = trpc.webhooks.create.useMutation({
    onSuccess: () => {
      utils.webhooks.list.invalidate();
      setIsCreateOpen(false);
      setFormData(EMPTY_FORM);
      toast.success(t('created'));
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  /** A save that met another change (CONFLICT) gets a message saying what to do */
  const updateErrorMessage = (error: { message: string; data?: { code?: string } | null }) =>
    error.data?.code === 'CONFLICT' ? t('conflict') : error.message;

  const updateWebhook = trpc.webhooks.update.useMutation({
    onSuccess: () => {
      utils.webhooks.list.invalidate();
      setEditingWebhook(null);
      toast.success(t('updated'));
    },
    onError: (error) => {
      toast.error(updateErrorMessage(error));
    },
  });

  const deleteWebhook = trpc.webhooks.delete.useMutation({
    onSuccess: () => {
      utils.webhooks.list.invalidate();
      toast.success(t('deleted'));
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const toggleWebhook = trpc.webhooks.update.useMutation({
    onSuccess: () => {
      utils.webhooks.list.invalidate();
    },
    onError: (error) => {
      toast.error(updateErrorMessage(error));
    },
  });

  const handleCreate = () => {
    if (!organization?.id) return;

    createWebhook.mutate({
      organizationId: organization.id,
      name: formData.name,
      url: formData.url,
      events: formData.events,
      headers: rowsToNewHeaders(formData.headers),
    });
  };

  const handleStartEdit = (webhook: NonNullable<typeof webhooks>['webhooks'][number]) => {
    setEditForm({
      name: webhook.name,
      url: webhook.url,
      events: webhook.events as WebhookEvent[],
      headers: rowsFromMaskedHeaders(webhook.headers),
      savedUrl: webhook.url,
    });
    setEditingWebhook(webhook.id);
  };

  const handleUpdate = () => {
    if (!organization?.id || !editingWebhook) return;

    updateWebhook.mutate({
      organizationId: organization.id,
      id: editingWebhook,
      name: editForm.name,
      url: editForm.url,
      events: editForm.events,
      headers: rowsToHeaderInput(editForm.headers),
    });
  };

  const handleToggleStatus = (webhookId: string, currentStatus: string) => {
    if (!organization?.id) return;

    toggleWebhook.mutate({
      organizationId: organization.id,
      id: webhookId,
      status: currentStatus === 'active' ? 'inactive' : 'active',
    });
  };

  const handleDelete = (webhookId: string) => {
    if (!organization?.id) return;
    if (!confirm(t('confirmDelete'))) return;

    deleteWebhook.mutate({
      organizationId: organization.id,
      id: webhookId,
    });
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success(t('copied'));
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-1 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
            <Check className="h-3 w-3" />
            Active
          </span>
        );
      case 'inactive':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-400">
            <Pause className="h-3 w-3" />
            Inactive
          </span>
        );
      case 'failed':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-1 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400">
            <AlertCircle className="h-3 w-3" />
            Failed
          </span>
        );
      default:
        return null;
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error?.data?.code === 'FORBIDDEN') {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-muted-foreground">{t('description')}</p>
        </div>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Lock className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">{t('forbidden')}</h3>
            <p className="text-muted-foreground text-center max-w-md">
              {t('forbiddenDescription')}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-muted-foreground">{t('description')}</p>
        </div>
        {canCreate && (
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                {t('create')}
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>{t('createTitle')}</DialogTitle>
                <DialogDescription>{t('createDescription')}</DialogDescription>
              </DialogHeader>

              <WebhookFormFields form={formData} onChange={setFormData} />

              <DialogFooter>
                <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
                  {t('cancel')}
                </Button>
                <Button
                  onClick={handleCreate}
                  disabled={!isFormComplete(formData) || createWebhook.isPending}
                >
                  {createWebhook.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {t('create')}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {/* Edit dialog */}
      <Dialog
        open={editingWebhook !== null}
        onOpenChange={(open) => {
          if (!open) setEditingWebhook(null);
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t('editTitle')}</DialogTitle>
            <DialogDescription>{t('editDescription')}</DialogDescription>
          </DialogHeader>

          <WebhookFormFields form={editForm} onChange={setEditForm} />

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingWebhook(null)}>
              {t('cancel')}
            </Button>
            <Button
              onClick={handleUpdate}
              disabled={!isFormComplete(editForm) || updateWebhook.isPending}
            >
              {updateWebhook.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Webhooks List */}
      {webhooks?.webhooks && webhooks.webhooks.length > 0 ? (
        <div className="grid gap-4">
          {webhooks.webhooks.map((webhook) => (
            <Card key={webhook.id}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Webhook className="h-5 w-5 text-muted-foreground" />
                      <CardTitle className="text-lg">{webhook.name}</CardTitle>
                      {getStatusBadge(webhook.status)}
                    </div>
                    <CardDescription className="flex items-center gap-2">
                      <ExternalLink className="h-3 w-3" />
                      <code className="text-xs">{webhook.url}</code>
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    {canUpdate && (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={webhook.status === 'active' ? t('pause') : t('resume')}
                          onClick={() => handleToggleStatus(webhook.id, webhook.status)}
                        >
                          {webhook.status === 'active' ? (
                            <Pause className="h-4 w-4" />
                          ) : (
                            <Play className="h-4 w-4" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t('edit')}
                          onClick={() => handleStartEdit(webhook)}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                    {canDelete && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t('delete')}
                        onClick={() => handleDelete(webhook.id)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {/* Events */}
                  <div>
                    <h4 className="text-sm font-medium mb-2">{t('subscribedEvents')}</h4>
                    <div className="flex flex-wrap gap-2">
                      {(webhook.events as WebhookEvent[]).map((event) => (
                        <span
                          key={event}
                          className="inline-flex items-center rounded-full bg-primary/10 px-2 py-1 text-xs font-medium text-primary"
                        >
                          {WEBHOOK_EVENTS.find((e) => e.value === event)?.label ?? event}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Secret */}
                  <div>
                    <h4 className="text-sm font-medium mb-2">{t('secret')}</h4>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 rounded bg-muted px-3 py-2 text-sm font-mono">
                        {showSecret === webhook.id ? webhook.secret : '••••••••••••••••'}
                      </code>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setShowSecret(showSecret === webhook.id ? null : webhook.id)}
                      >
                        {showSecret === webhook.id ? (
                          <X className="h-4 w-4" />
                        ) : (
                          <Activity className="h-4 w-4" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => copyToClipboard(webhook.secret)}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  {/* Custom headers: names only, values are never sent to the browser */}
                  {webhook.headers.length > 0 && (
                    <div>
                      <h4 className="text-sm font-medium mb-2">{t('headers')}</h4>
                      <div className="flex flex-wrap gap-2">
                        {webhook.headers.map((header) => (
                          <code
                            key={header.name}
                            className="rounded bg-muted px-2 py-1 text-xs font-mono"
                          >
                            {header.name}: {WEBHOOK_HEADER_MASK}
                          </code>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Stats */}
                  <div className="flex items-center gap-6 text-sm text-muted-foreground">
                    {webhook.lastTriggeredAt && (
                      <span>
                        {t('lastTriggered')}: {new Date(webhook.lastTriggeredAt).toLocaleString()}
                      </span>
                    )}
                    {webhook.failureCount > 0 && (
                      <span className="text-destructive">
                        {t('failures')}: {webhook.failureCount}
                      </span>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Webhook className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">{t('noWebhooks')}</h3>
            <p className="text-muted-foreground text-center mb-4 max-w-md">
              {t('noWebhooksDescription')}
            </p>
            {canCreate && (
              <Button onClick={() => setIsCreateOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                {t('createFirst')}
              </Button>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
