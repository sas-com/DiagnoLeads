'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  type AxMqlView,
  type AxSystemView,
  type ExtraDataEntry,
  readLeadDiagnosis,
} from '@/lib/features/leads/diagnosis-view';
import { ChevronDown, ChevronRight, ClipboardCheck } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import Link from 'next/link';
import { type ReactNode, useMemo, useState } from 'react';

const TIME_ZONE = 'Asia/Tokyo';

interface LeadDiagnosisCardProps {
  responses: unknown;
  customFields?: unknown;
  /** Smaller version for the list's side panel: no "other data" and no other systems */
  compact?: boolean;
  /** Where "回答を見る" goes for a submission (a link) ... */
  answersHref?: (submissionId: string) => string;
  /** ... or what it does (e.g. switch to the answers tab) */
  onShowAnswers?: (submissionId: string) => void;
}

interface Translate {
  (key: string): string;
  has: (key: string) => boolean;
}

/** Labels of the AX diagnosis values, with the wording of the result screen */
function useAxLabels() {
  const tAx = useTranslations('axDiagnosis');
  const tPipeline = useTranslations('pipeline');
  const t = useTranslations('leadDetail.diagnosis');
  const label = (translate: Translate, key: string, fallback: string) =>
    translate.has(key) ? translate(key) : fallback;
  return {
    platform: (value: string) => label(tAx, `platforms.${value}`, value),
    targetSystem: (value: string) => label(tPipeline, `targetSystem.${value}`, value),
    level: (value: string) => label(tAx, `result.levels.${value}`, value),
    challenge: (value: string | null) =>
      value ? label(tAx, `result.challenges.${value}.title`, value) : t('noPrimaryChallenge'),
    /** 適合 / 関心あり（MQL） and why, in one line (#139) */
    mqlReason: (mql: AxMqlView) => {
      if (mql.legacy) return t('mqlLegacy');
      if (mql.level === 'interest') {
        return mql.signals.map((signal) => t(`mqlSignals.${signal}`)).join('・');
      }
      if (mql.level === 'fit') return t('mqlNoSignal');
      return mql.unmet.length > 0
        ? t('mqlUnmet', {
            conditions: mql.unmet.map((key) => t(`mqlRequired.${key}`)).join('・'),
          })
        : '';
    },
  };
}

const MQL_LEVEL_KEYS = { interest: 'mqlInterest', fit: 'mqlFit', none: 'mqlNone' } as const;

/**
 * The diagnosis stored on the lead, readable (Refs #107): the AX summary with the result
 * screen's labels, flags as short badges, internal ids only behind "回答を見る", and anything
 * unknown in a collapsed "その他のデータ" list. Never raw JSON. Nothing when there is no data.
 */
export function LeadDiagnosisCard({
  responses,
  customFields,
  compact = false,
  answersHref,
  onShowAnswers,
}: LeadDiagnosisCardProps) {
  const t = useTranslations('leadDetail.diagnosis');
  const format = useFormatter();
  const labels = useAxLabels();
  const view = useMemo(() => readLeadDiagnosis(responses, customFields), [responses, customFields]);
  const { ax, extra } = view;

  if (!ax && (compact || extra.length === 0)) return null;

  const dateTime = (iso: string) =>
    format.dateTime(new Date(iso), {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: TIME_ZONE,
    });

  const answersLink = (submissionId: string | null, label: string) => {
    if (!submissionId) return null;
    if (answersHref) {
      return (
        <Link
          href={answersHref(submissionId)}
          aria-label={label}
          className="inline-flex min-h-9 items-center gap-1 text-sm text-blue-600 hover:underline dark:text-blue-400"
        >
          {t('showAnswers')}
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      );
    }
    if (onShowAnswers) {
      return (
        <Button
          variant="link"
          size="sm"
          className="h-auto min-h-9 px-0 text-blue-600 dark:text-blue-400"
          aria-label={label}
          onClick={() => onShowAnswers(submissionId)}
        >
          {t('showAnswers')}
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      );
    }
    return null;
  };

  const systemLine = (system: AxSystemView) =>
    [
      system.platform && labels.platform(system.platform),
      system.difficulty && `${t('difficulty')} ${labels.level(system.difficulty)}`,
      system.urgency && `${t('urgency')} ${labels.level(system.urgency)}`,
    ]
      .filter(Boolean)
      .join(' · ');

  const flags = ax && (
    <div className="flex flex-wrap gap-2">
      {ax.consultationRequested && <Badge color="violet">{t('consultation')}</Badge>}
      {ax.mql.level === 'interest' && (
        <Badge color="emerald" title={`${t('mqlInterestHelp')}（${labels.mqlReason(ax.mql)}）`}>
          {t('mqlInterest')}
        </Badge>
      )}
      {ax.mql.level === 'fit' && (
        <Badge color="gray" title={t('mqlFitHelp')}>
          {t('mqlFit')}
        </Badge>
      )}
      {ax.sqlSignals && (
        <Badge color="blue" title={t('sqlHelp')}>
          {t('sql')}
        </Badge>
      )}
      {ax.needsHearing && (
        <Badge color="amber" title={t('needsHearingHelp')}>
          {t('needsHearing')}
        </Badge>
      )}
    </div>
  );

  if (compact && ax) {
    return (
      <section aria-labelledby="lead-diagnosis-compact" className="space-y-2">
        <h3 id="lead-diagnosis-compact" className="text-sm font-semibold text-foreground">
          {t('title')}
        </h3>
        {flags}
        <p className="text-sm text-foreground">{systemLine(ax)}</p>
        <p className="text-sm text-muted-foreground">
          {t('primaryChallenge')}：{labels.challenge(ax.primaryChallenge)}
        </p>
      </section>
    );
  }

  const rows: { key: string; label: string; value: ReactNode }[] = [];
  if (ax) {
    if (ax.platform)
      rows.push({ key: 'platform', label: t('platform'), value: labels.platform(ax.platform) });
    if (ax.targetSystem) {
      rows.push({
        key: 'targetSystem',
        label: t('targetSystem'),
        value: labels.targetSystem(ax.targetSystem),
      });
    }
    if (ax.difficulty)
      rows.push({ key: 'difficulty', label: t('difficulty'), value: labels.level(ax.difficulty) });
    if (ax.urgency)
      rows.push({ key: 'urgency', label: t('urgency'), value: labels.level(ax.urgency) });
    rows.push({
      key: 'primaryChallenge',
      label: t('primaryChallenge'),
      value: labels.challenge(ax.primaryChallenge),
    });
    const others = ax.challenges.filter((challenge) => challenge !== ax.primaryChallenge);
    if (others.length > 0) {
      rows.push({
        key: 'challenges',
        label: t('challenges'),
        value: (
          <ul className="space-y-0.5">
            {ax.challenges.map((challenge) => (
              <li key={challenge}>{labels.challenge(challenge)}</li>
            ))}
          </ul>
        ),
      });
    }
    const mqlReason = labels.mqlReason(ax.mql);
    rows.push({
      key: 'mql',
      label: t('mqlJudgement'),
      value: (
        <span data-testid="lead-diagnosis-mql">
          {t(MQL_LEVEL_KEYS[ax.mql.level])}
          {mqlReason && (
            <span className="block text-xs font-normal text-muted-foreground">{mqlReason}</span>
          )}
        </span>
      ),
    });
    if (ax.department)
      rows.push({ key: 'department', label: t('department'), value: ax.department });
    if (ax.diagnosedAt)
      rows.push({ key: 'diagnosedAt', label: t('diagnosedAt'), value: dateTime(ax.diagnosedAt) });
    if (ax.detailsAnsweredAt) {
      rows.push({
        key: 'detailsAnsweredAt',
        label: t('detailsAnsweredAt'),
        value: dateTime(ax.detailsAnsweredAt),
      });
    }
  }

  return (
    <Card className="p-5" data-testid="lead-diagnosis-card">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
          <ClipboardCheck className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
          {t('title')}
        </h2>
        {ax && answersLink(ax.submissionId, `${t('title')}：${t('showAnswers')}`)}
      </div>

      {flags}

      {rows.length > 0 && (
        <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {rows.map((row) => (
            <div key={row.key} className="min-w-0">
              <dt className="text-xs text-muted-foreground">{row.label}</dt>
              <dd className="mt-0.5 break-words text-sm font-medium text-foreground">
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {ax && ax.otherSystems.length > 0 && (
        <div className="mt-4 border-t pt-3 dark:border-gray-700">
          <h3 className="mb-2 text-xs text-muted-foreground">{t('otherSystems')}</h3>
          <ul className="space-y-2">
            {ax.otherSystems.map((system, index) => (
              <li
                key={system.submissionId ?? index}
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1"
              >
                <div className="min-w-0 text-sm">
                  <p className="font-medium text-foreground">{systemLine(system)}</p>
                  <p className="text-muted-foreground">
                    {t('primaryChallenge')}：{labels.challenge(system.primaryChallenge)}
                    {system.diagnosedAt && ` · ${dateTime(system.diagnosedAt)}`}
                  </p>
                  {system.needsHearing && (
                    <Badge color="amber" className="mt-1" title={t('needsHearingHelp')}>
                      {t('needsHearing')}
                    </Badge>
                  )}
                </div>
                {answersLink(system.submissionId, `${systemLine(system)}：${t('showAnswers')}`)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {extra.length > 0 && <ExtraData entries={extra} />}
    </Card>
  );
}

/** Values the view does not know, collapsed: key / value text, never JSON */
function ExtraData({ entries }: { entries: ExtraDataEntry[] }) {
  const t = useTranslations('leadDetail.diagnosis');
  const [open, setOpen] = useState(false);
  const text = (value: ExtraDataEntry['value']) =>
    typeof value === 'boolean' ? (value ? t('yes') : t('no')) : String(value);

  return (
    <div className="mt-4 border-t pt-3 dark:border-gray-700">
      <Button
        variant="ghost"
        size="sm"
        className="h-auto min-h-9 px-0 text-muted-foreground hover:bg-transparent hover:text-foreground"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? (
          <ChevronDown className="h-4 w-4" aria-hidden="true" />
        ) : (
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        )}
        {t('extraTitle', { count: entries.length })}
      </Button>
      {open && (
        <dl className="mt-2 space-y-1 text-sm" data-testid="lead-extra-data">
          {entries.map((entry) => (
            <div key={entry.key} className="grid gap-x-3 sm:grid-cols-[12rem_1fr]">
              <dt className="break-all text-muted-foreground">{entry.key}</dt>
              <dd className="break-words text-foreground">{text(entry.value)}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
