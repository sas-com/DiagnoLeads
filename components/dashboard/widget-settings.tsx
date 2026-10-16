'use client';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { ChevronDown, ChevronUp, GripVertical, Settings2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

export interface WidgetConfig {
  id: string;
  enabled: boolean;
  order: number;
}

export interface WidgetDefinition {
  id: string;
  titleKey: string;
  descriptionKey: string;
  icon: React.ReactNode;
}

interface WidgetSettingsProps {
  widgets: WidgetDefinition[];
  config: WidgetConfig[];
  onConfigChange: (config: WidgetConfig[]) => void;
  /** Icon-only trigger (narrow screens); the label stays for screen readers */
  compact?: boolean;
}

/** Settings saved since the order is applied to the page */
const STORAGE_KEY = 'dashboard-widget-config-v2';
/**
 * Earlier settings: their order was never applied (always the default), so only the shown/hidden
 * choices are carried over and the current default order wins.
 */
const LEGACY_STORAGE_KEY = 'dashboard-widget-config';

/**
 * Saved settings meet the current widget list: widgets that no longer exist are dropped and new
 * ones are shown, so a redesign never hides a widget behind an old saved setting. With
 * `keepOrder`, the saved order is kept and new widgets take their default place.
 */
export function reconcileWidgetConfig(
  stored: unknown,
  defaultWidgets: string[],
  { keepOrder = false }: { keepOrder?: boolean } = {}
): WidgetConfig[] {
  const saved = Array.isArray(stored) ? (stored as WidgetConfig[]) : [];
  const entries = defaultWidgets.map((id, index) => {
    const entry = saved.find((item) => item?.id === id);
    return { id, enabled: entry ? entry.enabled !== false : true, entry, index };
  });
  if (!keepOrder) {
    return entries.map(({ id, enabled }, order) => ({ id, enabled, order }));
  }
  const ordered = entries
    .filter((item) => item.entry && Number.isFinite(item.entry.order))
    .sort((a, b) => Number(a.entry?.order) - Number(b.entry?.order));
  for (const item of entries) {
    if (!ordered.includes(item)) ordered.splice(Math.min(item.index, ordered.length), 0, item);
  }
  return ordered.map(({ id, enabled }, order) => ({ id, enabled, order }));
}

/** Widget ids in display order, shown ones only */
export function visibleWidgetIds(config: WidgetConfig[]): string[] {
  return [...config]
    .sort((a, b) => a.order - b.order)
    .filter((item) => item.enabled)
    .map((item) => item.id);
}

/** Moves one widget up (-1) or down (+1) and renumbers the order */
export function moveWidget(config: WidgetConfig[], id: string, step: -1 | 1): WidgetConfig[] {
  const sorted = [...config].sort((a, b) => a.order - b.order);
  const from = sorted.findIndex((item) => item.id === id);
  const to = from + step;
  if (from < 0 || to < 0 || to >= sorted.length) return config;
  const [item] = sorted.splice(from, 1);
  sorted.splice(to, 0, item);
  return sorted.map((entry, order) => ({ ...entry, order }));
}

function readStored(key: string): unknown {
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

export function useWidgetConfig(
  defaultWidgets: string[]
): [WidgetConfig[], (config: WidgetConfig[]) => void] {
  const [config, setConfig] = useState<WidgetConfig[]>(() => {
    if (typeof window === 'undefined') {
      return defaultWidgets.map((id, index) => ({ id, enabled: true, order: index }));
    }

    const stored = readStored(STORAGE_KEY);
    if (stored) return reconcileWidgetConfig(stored, defaultWidgets, { keepOrder: true });
    return reconcileWidgetConfig(readStored(LEGACY_STORAGE_KEY), defaultWidgets);
  });

  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
      } catch {
        // Storage unavailable (private mode): the settings last for this visit only
      }
    }
  }, [config]);

  return [config, setConfig];
}

export function WidgetSettings({
  widgets,
  config,
  onConfigChange,
  compact = false,
}: WidgetSettingsProps) {
  const t = useTranslations('dashboard.widgets');
  const tCommon = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [localConfig, setLocalConfig] = useState<WidgetConfig[]>(config);
  const [draggedItem, setDraggedItem] = useState<string | null>(null);

  useEffect(() => {
    setLocalConfig(config);
  }, [config]);

  const handleToggle = (id: string, enabled: boolean) => {
    setLocalConfig((prev) => prev.map((item) => (item.id === id ? { ...item, enabled } : item)));
  };

  const handleMove = (id: string, step: -1 | 1) => {
    setLocalConfig((prev) => moveWidget(prev, id, step));
  };

  const handleDragStart = (id: string) => {
    setDraggedItem(id);
  };

  const handleDragOver = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    if (!draggedItem || draggedItem === targetId) return;

    setLocalConfig((prev) => {
      const draggedIndex = prev.findIndex((item) => item.id === draggedItem);
      const targetIndex = prev.findIndex((item) => item.id === targetId);

      const newConfig = [...prev];
      const [draggedWidget] = newConfig.splice(draggedIndex, 1);
      newConfig.splice(targetIndex, 0, draggedWidget);

      return newConfig.map((item, index) => ({ ...item, order: index }));
    });
  };

  const handleDragEnd = () => {
    setDraggedItem(null);
  };

  const handleSave = () => {
    onConfigChange(localConfig);
    setOpen(false);
  };

  const handleReset = () => {
    const defaultConfig = widgets.map((w, index) => ({
      id: w.id,
      enabled: true,
      order: index,
    }));
    setLocalConfig(defaultConfig);
  };

  const sortedWidgets = [...localConfig].sort((a, b) => a.order - b.order);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {compact ? (
          <Button variant="outline" size="icon" className="h-9 w-9" aria-label={t('customize')}>
            <Settings2 className="h-4 w-4" aria-hidden="true" />
          </Button>
        ) : (
          <Button variant="outline" size="sm">
            <Settings2 className="h-4 w-4" aria-hidden="true" />
            {t('customize')}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        <div className="py-4 space-y-2">
          {sortedWidgets.map((item, position) => {
            const widget = widgets.find((w) => w.id === item.id);
            if (!widget) return null;
            const title = t(widget.titleKey);

            return (
              <div
                key={item.id}
                draggable
                onDragStart={() => handleDragStart(item.id)}
                onDragOver={(e) => handleDragOver(e, item.id)}
                onDragEnd={handleDragEnd}
                className={cn(
                  'flex items-center gap-2 rounded-lg border p-3 transition-colors sm:gap-3',
                  draggedItem === item.id
                    ? 'border-brand-500 bg-brand-50 dark:bg-brand-500/10'
                    : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800'
                )}
              >
                <GripVertical
                  className="h-4 w-4 flex-shrink-0 cursor-move text-gray-400"
                  aria-hidden="true"
                />
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-700">
                  {widget.icon}
                </div>
                <div className="min-w-0 flex-1">
                  <Label
                    htmlFor={item.id}
                    className="cursor-pointer text-sm font-medium text-gray-900 dark:text-gray-50"
                  >
                    {title}
                  </Label>
                  <p className="truncate text-xs text-gray-500 dark:text-gray-400">
                    {t(widget.descriptionKey)}
                  </p>
                </div>
                <div className="flex flex-shrink-0 flex-col">
                  <button
                    type="button"
                    onClick={() => handleMove(item.id, -1)}
                    disabled={position === 0}
                    aria-label={t('moveUp', { name: title })}
                    className="rounded p-0.5 text-gray-500 hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-30 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-50"
                  >
                    <ChevronUp className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleMove(item.id, 1)}
                    disabled={position === sortedWidgets.length - 1}
                    aria-label={t('moveDown', { name: title })}
                    className="rounded p-0.5 text-gray-500 hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-30 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-50"
                  >
                    <ChevronDown className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
                <Switch
                  id={item.id}
                  checked={item.enabled}
                  onCheckedChange={(checked) => handleToggle(item.id, checked)}
                  className="aria-checked:bg-brand-500 dark:aria-checked:bg-brand-600"
                />
              </div>
            );
          })}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={handleReset} className="w-full sm:w-auto">
            {t('reset')}
          </Button>
          <Button onClick={handleSave} className="w-full sm:w-auto">
            {tCommon('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DashboardWidget({
  id,
  config,
  children,
}: {
  id: string;
  config: WidgetConfig[];
  children: React.ReactNode;
}) {
  const widgetConfig = config.find((c) => c.id === id);

  if (!widgetConfig?.enabled) {
    return null;
  }

  return <>{children}</>;
}
