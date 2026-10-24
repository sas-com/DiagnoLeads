'use client';

import { InlineLoadError } from '@/components/common/inline-load-error';
import { Card } from '@/components/ui/card';
import { trpc } from '@/lib/trpc/client';
import { Lightbulb, Loader2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useId } from 'react';

interface ChallengeGuideCardProps {
  organizationId: string;
  leadId: string;
}

/**
 * What to ask next (Refs #75): the sales playbook's guide (#74) for the main challenge of the
 * lead's AX diagnosis, with the effect to explain, the questions to dig deeper and the answers
 * that signal an opportunity. Shown for leads with an AX diagnosis, to those who may read the
 * playbook.
 */
export function ChallengeGuideCard({ organizationId, leadId }: ChallengeGuideCardProps) {
  const t = useTranslations('challengeGuide');
  const tChallenge = useTranslations('leadHearings.options.challenge');
  const locale = useLocale();
  const id = useId();
  const query = trpc.challengeGuide.get.useQuery(
    { organizationId, leadId },
    { enabled: !!organizationId, retry: false }
  );

  // Hidden from those who may not read the playbook; a failed request shows an error (#431)
  if (query.error?.data?.code === 'FORBIDDEN') return null;
  const data = query.data;
  if (data && !data.hasDiagnosis) return null;

  const playbookLink = (
    <Link
      href={`/${locale}/settings/ax-playbook`}
      className="text-blue-600 hover:underline dark:text-blue-400"
    >
      {t('openPlaybook')}
    </Link>
  );
  const list = (key: 'questions' | 'signals', items: string[]) =>
    items.length > 0 && (
      <section aria-labelledby={`${id}-${key}`}>
        <h3 id={`${id}-${key}`} className="mb-1 text-xs text-muted-foreground">
          {t(key)}
        </h3>
        <ul className="list-disc space-y-1 pl-5 text-sm text-foreground">
          {items.map((item) => (
            <li key={item} className="whitespace-pre-wrap break-words">
              {item}
            </li>
          ))}
        </ul>
      </section>
    );

  return (
    <Card className="p-5" data-testid="challenge-guide">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Lightbulb className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-foreground">{t('title')}</h2>
        {data?.primary && (
          <span className="text-xs text-muted-foreground">
            {t('primary', { challenge: tChallenge(data.primary) })}
          </span>
        )}
      </div>

      {!data && query.isError ? (
        <InlineLoadError onRetry={() => void query.refetch()} />
      ) : !data ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />
      ) : !data.primary ? (
        <p className="text-sm text-muted-foreground">{t('noChallenge')}</p>
      ) : !data.hasPlaybook ? (
        <p className="text-sm text-muted-foreground">
          {t('noPlaybook')} {playbookLink}
        </p>
      ) : !data.guide ? (
        <p className="text-sm text-muted-foreground">
          {t('noGuide', { challenge: tChallenge(data.primary) })} {playbookLink}
        </p>
      ) : (
        <div className="space-y-4">
          {data.guide.effect && (
            <section aria-labelledby={`${id}-effect`}>
              <h3 id={`${id}-effect`} className="mb-1 text-xs text-muted-foreground">
                {t('effect')}
              </h3>
              <p className="whitespace-pre-wrap break-words text-sm text-foreground">
                {data.guide.effect}
              </p>
            </section>
          )}
          {list('questions', data.guide.questions)}
          {list('signals', data.guide.signals)}
        </div>
      )}
    </Card>
  );
}
