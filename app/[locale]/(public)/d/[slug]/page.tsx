import { DiagnosisFlow } from '@/components/features/public-diagnosis/diagnosis-flow';
import { db } from '@/lib/db/client';
import { allowedEmailDomains } from '@/lib/email/allowed-recipients';
import { toPublicDefinition } from '@/lib/features/diagnosis-builder/evaluate';
import { findPublicDiagnosis } from '@/lib/features/diagnosis-builder/public-diagnosis';
import { turnstileSiteKey } from '@/lib/features/diagnostics/turnstile';
import { NOINDEX } from '@/lib/seo/indexing';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { cache } from 'react';

/** Always the current published version */
export const dynamic = 'force-dynamic';

interface DiagnosisPageProps {
  params: Promise<{ locale: string; slug: string }>;
}

/** One lookup per request, shared by the metadata and the page */
const loadDiagnosis = cache((slug: string) => findPublicDiagnosis(db, slug));

export async function generateMetadata({ params }: DiagnosisPageProps): Promise<Metadata> {
  const { slug } = await params;
  const diagnosis = await loadDiagnosis(slug);
  return {
    title: diagnosis ? { absolute: diagnosis.current.definition.title } : undefined,
    description: diagnosis?.current.definition.description?.slice(0, 160),
    // Builder diagnoses are not indexed (decision 2026-10-16, lib/seo/indexing.ts)
    robots: NOINDEX,
  };
}

/**
 * A diagnosis made in the builder, as published (/d/[slug]). Only the respondent view of the
 * definition (toPublicDefinition: no points, weights or lead rules) reaches the browser; answers
 * are scored by POST /api/diagnoses/[slug]/submit.
 */
export default async function PublicDiagnosisPage({ params }: DiagnosisPageProps) {
  const { locale: requested, slug } = await params;
  const locale = requested === 'en' ? 'en' : 'ja';
  const diagnosis = await loadDiagnosis(slug);
  if (!diagnosis) notFound();

  const siteKey = turnstileSiteKey();
  const t = await getTranslations({ locale, namespace: 'publicDiagnosis' });
  const definition = toPublicDefinition(diagnosis.current.definition);

  return (
    <div className="min-h-screen bg-gradient-to-b from-white to-ax-mist text-ax-ink">
      <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:py-14">
        <div className="rounded-3xl bg-white p-5 shadow-[0_10px_40px_rgba(0,0,0,0.08)] ring-1 ring-black/5 sm:p-10">
          {siteKey ? (
            <DiagnosisFlow
              slug={diagnosis.slug}
              versionId={diagnosis.current.id}
              version={diagnosis.current.version}
              definition={definition}
              locale={locale}
              turnstileSiteKey={siteKey}
              allowedEmailDomains={allowedEmailDomains()}
            />
          ) : (
            // The bot check is required for builder diagnoses: no form without it
            <div className="space-y-3">
              <h1 className="text-2xl font-bold">{definition.title}</h1>
              <p className="leading-relaxed text-gray-700">{t('unavailable')}</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
