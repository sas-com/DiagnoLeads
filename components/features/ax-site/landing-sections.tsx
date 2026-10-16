import { AxDiagnosisFlow } from '@/components/features/ax-diagnosis/ax-diagnosis-flow';
import { allowedEmailDomains } from '@/lib/email/allowed-recipients';
import { turnstileSiteKey } from '@/lib/features/diagnostics/turnstile';
import type { DiagnosticLocale } from '@/lib/features/diagnostics/types';
import { cn } from '@/lib/utils';
import {
  Bot,
  ChevronDown,
  Cpu,
  Database,
  Layers,
  ScanSearch,
  Server,
  ShieldCheck,
  Sprout,
} from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { AxCtaLink } from './ax-cta-link';
import { AX_SECTIONS, axConsultationUrl, axPrivacyPolicyUrl } from './site-config';

interface SectionProps {
  locale: DiagnosticLocale;
}

const SECTION_HEADING = 'text-center text-2xl font-bold leading-snug sm:text-[2.25rem]';
const EYEBROW = 'text-center font-ax-latin text-sm font-bold tracking-[0.2em] text-ax-teal-dark';

/** "＼ … ／" frames the caption in Japanese; screen readers skip the marks */
function CtaCaption({
  locale,
  className,
  children,
}: {
  locale: DiagnosticLocale;
  className?: string;
  children: ReactNode;
}) {
  return (
    <p className={cn('text-sm font-bold', className)}>
      {locale === 'ja' && <span aria-hidden="true">＼ </span>}
      {children}
      {locale === 'ja' && <span aria-hidden="true"> ／</span>}
    </p>
  );
}

export async function AxHero({ locale }: SectionProps) {
  const t = await getTranslations({ locale, namespace: 'axSite.hero' });
  const consultationUrl = axConsultationUrl();

  return (
    <section aria-labelledby="ax-hero-heading" className="relative overflow-hidden bg-white">
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-14 sm:px-6 md:py-20 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="space-y-6">
          <p
            aria-hidden="true"
            className="font-ax-latin text-sm font-bold tracking-[0.2em] text-ax-teal-dark"
          >
            {t('eyebrow')}
          </p>
          <h1
            id="ax-hero-heading"
            className="text-[1.75rem] font-bold leading-snug sm:text-4xl lg:text-[2.6rem] lg:leading-[1.35]"
          >
            {t('title')}
          </h1>
          <p className="text-lg font-bold">{t('tagline')}</p>
          <p className="font-bold leading-relaxed">{t('lead')}</p>
          <div className="space-y-3 pt-2">
            <CtaCaption locale={locale}>{t('ctaCaption')}</CtaCaption>
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <AxCtaLink href={`#${AX_SECTIONS.diagnosis}`} location="hero">
                {t('cta')}
              </AxCtaLink>
              {consultationUrl && (
                <AxCtaLink href={consultationUrl} variant="consultation" location="hero" external>
                  {t('consult')}
                </AxCtaLink>
              )}
            </div>
          </div>
        </div>

        <figure className="relative mx-auto w-full max-w-md">
          {/* Decorative glow in the site's lime-to-teal gradient */}
          <div
            aria-hidden="true"
            className="absolute -inset-6 rounded-[3rem] bg-gradient-to-br from-ax-lime to-ax-teal opacity-30 blur-2xl"
          />
          <div
            aria-hidden="true"
            className="relative space-y-4 rounded-3xl bg-white p-6 shadow-[0_12px_40px_rgba(0,0,0,0.12)] ring-1 ring-black/5"
          >
            <p className="text-sm font-bold text-ax-teal-dark">{t('preview.title')}</p>
            <div className="grid grid-cols-2 gap-3">
              <PreviewLevel
                label={t('preview.difficulty')}
                level={t('preview.medium')}
                tone="medium"
              />
              <PreviewLevel label={t('preview.urgency')} level={t('preview.high')} tone="high" />
            </div>
            <div className="rounded-2xl bg-ax-mist p-4">
              <p className="text-xs font-bold text-ax-teal-dark">{t('preview.challenge')}</p>
              <p className="mt-1 font-bold">{t('preview.challengeValue')}</p>
            </div>
            <div className="rounded-2xl bg-ax-teal-dark px-4 py-3 text-center text-sm font-bold text-white">
              {t('preview.next')}
            </div>
          </div>
          <figcaption className="relative mt-3 text-center text-xs text-gray-600">
            {t('preview.caption')}
          </figcaption>
        </figure>
      </div>
    </section>
  );
}

function PreviewLevel({
  label,
  level,
  tone,
}: {
  label: string;
  level: string;
  tone: 'medium' | 'high';
}) {
  return (
    <div className="space-y-2 rounded-2xl border border-gray-200 p-3">
      <p className="text-xs font-bold text-gray-600">{label}</p>
      <p
        className={
          tone === 'high'
            ? 'inline-block rounded-full bg-ax-coral-dark px-3 py-0.5 text-sm font-bold text-white'
            : 'inline-block rounded-full bg-ax-yellow px-3 py-0.5 text-sm font-bold text-ax-ink'
        }
      >
        {level}
      </p>
      <div className="h-1.5 rounded-full bg-gray-100">
        <div
          className={
            tone === 'high'
              ? 'h-1.5 w-4/5 rounded-full bg-ax-coral-dark'
              : 'h-1.5 w-1/2 rounded-full bg-ax-yellow-dark'
          }
        />
      </div>
    </div>
  );
}

const PROBLEM_KEYS = ['people', 'blackbox', 'cost', 'eos', 'access', 'start'] as const;

export async function AxProblems({ locale }: SectionProps) {
  const t = await getTranslations({ locale, namespace: 'axSite.problems' });
  return (
    <section
      id={AX_SECTIONS.problems}
      aria-labelledby="ax-problems-heading"
      className="relative scroll-mt-20 overflow-hidden bg-gradient-to-br from-ax-lime via-[#8cc386] to-ax-teal py-16 sm:py-24"
    >
      {/* Faint rings like the lightbulb motif of maru2-dx.com */}
      <div
        aria-hidden="true"
        className="absolute -left-24 top-10 h-96 w-96 rounded-full border-[48px] border-white/20"
      />
      <div
        aria-hidden="true"
        className="absolute -right-16 bottom-0 h-72 w-72 rounded-full border-[36px] border-white/15"
      />
      <div className="relative mx-auto max-w-5xl px-4 text-center sm:px-6">
        <h2
          id="ax-problems-heading"
          className="inline-block bg-white px-6 py-2 text-2xl font-bold sm:text-[2.25rem]"
        >
          {t('title')}
        </h2>
        <p className="mt-5">
          <span className="inline-block bg-white px-5 py-1.5 text-lg font-bold text-ax-teal-dark sm:text-2xl">
            {t('lead')}
          </span>
        </p>
        <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PROBLEM_KEYS.map((key) => (
            <li
              key={key}
              className="flex min-h-24 items-center justify-center rounded-[2.5rem] border-2 border-ax-ink bg-white px-6 py-4 text-center font-bold leading-relaxed"
            >
              {t(`items.${key}`)}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

const STEP_KEYS = ['simple', 'survey', 'migration', 'ax'] as const;

export async function AxSteps({ locale }: SectionProps) {
  const t = await getTranslations({ locale, namespace: 'axSite.steps' });
  return (
    <section
      id={AX_SECTIONS.steps}
      aria-labelledby="ax-steps-heading"
      className="scroll-mt-20 bg-ax-mist py-16 sm:py-24"
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <h2 id="ax-steps-heading" className={SECTION_HEADING}>
          {t('title')}
        </h2>
        <p className="mx-auto mt-5 max-w-2xl text-center font-bold leading-relaxed">{t('lead')}</p>
        <ol className="mt-14 grid gap-10 md:grid-cols-4 md:gap-5">
          {STEP_KEYS.map((key, index) => (
            <li key={key} className="relative rounded-2xl bg-white p-6 pt-10 shadow-sm">
              <span
                aria-hidden="true"
                className="absolute -top-6 left-6 flex h-12 w-12 items-center justify-center rounded-full border-4 border-white bg-ax-deep font-ax-latin text-lg font-black text-white"
              >
                {String(index + 1).padStart(2, '0')}
              </span>
              <p className="font-ax-latin text-xs font-bold tracking-widest text-ax-teal-dark">
                {t('stepLabel', { number: index + 1 })}
              </p>
              <h3 className="mt-1 text-lg font-bold">{t(`items.${key}.title`)}</h3>
              <p className="mt-3 text-sm leading-relaxed text-gray-700">{t(`items.${key}.body`)}</p>
            </li>
          ))}
        </ol>
        <p className="mt-10 text-center text-sm font-bold">{t('note')}</p>
      </div>
    </section>
  );
}

const TARGETS = [
  { key: 'as400', icon: Server },
  { key: 'acos', icon: Cpu },
  { key: 'access', icon: Database },
  { key: 'other', icon: Layers },
] as const;

export async function AxTargets({ locale }: SectionProps) {
  const t = await getTranslations({ locale, namespace: 'axSite.targets' });
  return (
    <section
      id={AX_SECTIONS.targets}
      aria-labelledby="ax-targets-heading"
      className="scroll-mt-20 bg-white py-16 sm:py-24"
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <h2 id="ax-targets-heading" className={SECTION_HEADING}>
          {t('title')}
        </h2>
        <p className="mx-auto mt-5 max-w-2xl text-center font-bold leading-relaxed">{t('lead')}</p>
        <ul className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {TARGETS.map(({ key, icon: Icon }) => (
            <li
              key={key}
              className="flex flex-col rounded-2xl border border-gray-200 bg-white p-6 shadow-sm"
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-ax-teal text-white">
                <Icon className="h-6 w-6" aria-hidden="true" />
              </span>
              <h3 className="mt-4 text-lg font-bold">{t(`items.${key}.name`)}</h3>
              <p className="mt-2 text-sm leading-relaxed text-gray-700">{t(`items.${key}.body`)}</p>
            </li>
          ))}
        </ul>
        <p className="mt-10 text-center text-sm font-bold text-ax-teal-dark">{t('industries')}</p>
      </div>
    </section>
  );
}

export async function AxDiagnosisSection({ locale }: SectionProps) {
  const t = await getTranslations({ locale, namespace: 'axSite.diagnosis' });
  return (
    <section
      id={AX_SECTIONS.diagnosis}
      aria-labelledby="ax-diagnosis-heading"
      className="scroll-mt-16 bg-gradient-to-b from-white to-ax-mist py-16 sm:py-24"
    >
      <div className="mx-auto max-w-4xl px-4 sm:px-6">
        <p aria-hidden="true" className={EYEBROW}>
          {t('eyebrow')}
        </p>
        <h2 id="ax-diagnosis-heading" className={`mt-2 ${SECTION_HEADING}`}>
          {t('title')}
        </h2>
        <p className="mx-auto mt-5 max-w-2xl text-center font-bold leading-relaxed">{t('lead')}</p>
        <div className="mt-10 rounded-3xl bg-white p-5 shadow-[0_10px_40px_rgba(0,0,0,0.08)] ring-1 ring-black/5 sm:p-10">
          <AxDiagnosisFlow
            locale={locale}
            privacyPolicyUrl={axPrivacyPolicyUrl()}
            turnstileSiteKey={turnstileSiteKey()}
            allowedEmailDomains={allowedEmailDomains()}
            embedded
          />
        </div>
      </div>
    </section>
  );
}

const REASONS = [
  { key: 'visualize', icon: ScanSearch },
  { key: 'keep', icon: ShieldCheck },
  { key: 'small', icon: Sprout },
  { key: 'ax', icon: Bot },
] as const;

export async function AxReasons({ locale }: SectionProps) {
  const t = await getTranslations({ locale, namespace: 'axSite.reasons' });
  return (
    <section aria-labelledby="ax-reasons-heading" className="bg-ax-deep py-16 text-white sm:py-24">
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        <h2 id="ax-reasons-heading" className={SECTION_HEADING}>
          {t('title')}
        </h2>
        <ul className="mt-12 grid gap-5 md:grid-cols-2">
          {REASONS.map(({ key, icon: Icon }) => (
            <li key={key} className="flex gap-4 rounded-2xl bg-white p-6 text-ax-ink">
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-ax-teal text-white">
                <Icon className="h-7 w-7" aria-hidden="true" />
              </span>
              <div>
                <h3 className="text-lg font-bold">{t(`items.${key}.title`)}</h3>
                <p className="mt-2 text-sm leading-relaxed text-gray-700">
                  {t(`items.${key}.body`)}
                </p>
              </div>
            </li>
          ))}
        </ul>
        <div className="mt-10 rounded-2xl border border-white/30 p-6 text-center">
          <p className="font-bold">{t('certified.title')}</p>
          <p className="mt-2 text-sm leading-relaxed text-white/90">{t('certified.body')}</p>
        </div>
      </div>
    </section>
  );
}

const FAQ_KEYS = ['cost', 'who', 'targets', 'result', 'privacy'] as const;

export async function AxFaq({ locale }: SectionProps) {
  const t = await getTranslations({ locale, namespace: 'axSite.faq' });
  return (
    <section
      id={AX_SECTIONS.faq}
      aria-labelledby="ax-faq-heading"
      className="scroll-mt-20 bg-ax-mist py-16 sm:py-24"
    >
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <h2 id="ax-faq-heading" className={SECTION_HEADING}>
          {t('title')}
        </h2>
        <div className="mt-10 space-y-3">
          {FAQ_KEYS.map((key) => (
            <details key={key} className="group rounded-2xl bg-white p-5 shadow-sm">
              <summary className="flex cursor-pointer list-none items-start justify-between gap-4 font-bold [&::-webkit-details-marker]:hidden">
                <span className="flex gap-3">
                  <span aria-hidden="true" className="font-ax-latin text-ax-teal-dark">
                    Q.
                  </span>
                  {t(`items.${key}.q`)}
                </span>
                <ChevronDown
                  className="mt-0.5 h-5 w-5 shrink-0 group-open:rotate-180 motion-safe:transition-transform"
                  aria-hidden="true"
                />
              </summary>
              <p className="mt-3 flex gap-3 leading-relaxed text-gray-700">
                <span aria-hidden="true" className="font-ax-latin font-bold text-ax-coral-dark">
                  A.
                </span>
                <span>{t(`items.${key}.a`)}</span>
              </p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

export async function AxFinalCta({ locale }: SectionProps) {
  const t = await getTranslations({ locale, namespace: 'axSite.finalCta' });
  const consultationUrl = axConsultationUrl();
  return (
    <section
      aria-labelledby="ax-final-heading"
      className="bg-gradient-to-br from-ax-teal-dark to-ax-deep py-16 text-center text-white sm:py-20"
    >
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <h2 id="ax-final-heading" className="text-2xl font-bold leading-snug sm:text-3xl">
          {t('title')}
        </h2>
        <CtaCaption locale={locale} className="mt-8">
          {t('caption')}
        </CtaCaption>
        <div className="mt-3 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <AxCtaLink href={`#${AX_SECTIONS.diagnosis}`} location="final" tone="dark">
            {t('cta')}
          </AxCtaLink>
          {consultationUrl && (
            <AxCtaLink
              href={consultationUrl}
              variant="consultation"
              location="final"
              tone="dark"
              external
              className="bg-white text-ax-teal-dark hover:bg-ax-mist"
            >
              {t('consult')}
            </AxCtaLink>
          )}
        </div>
      </div>
    </section>
  );
}
