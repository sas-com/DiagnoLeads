import { AxDiagnosisFlow } from '@/components/features/ax-diagnosis/ax-diagnosis-flow';
import { allowedEmailDomains } from '@/lib/email/allowed-recipients';
import { turnstileSiteKey } from '@/lib/features/diagnostics/turnstile';
import type { DiagnosticLocale } from '@/lib/features/diagnostics/types';
import { cn } from '@/lib/utils';
import {
  ArrowDown,
  Bot,
  ChartNoAxesCombined,
  Check,
  ChevronDown,
  ClipboardList,
  Cpu,
  Database,
  Gauge,
  Layers,
  Mail,
  MonitorUp,
  Phone,
  Server,
  ShieldCheck,
  Timer,
} from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { AxCtaLink } from './ax-cta-link';
import {
  AX_CONTACT,
  AX_FINAL_SECTION_ID,
  AX_SECTIONS,
  axConsultationUrl,
  axPrivacyPolicyUrl,
} from './site-config';

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
      className="relative overflow-hidden bg-gradient-to-br from-ax-lime via-[#8cc386] to-ax-teal py-16 sm:py-24"
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

const CHALLENGE_KEYS = ['people', 'agility', 'cost', 'data'] as const;
const SOLUTION_KEYS = ['first', 'second'] as const;

/** Brochure: the four challenges (people, things, money, information) and what AX migration brings */
export async function AxChallenges({ locale }: SectionProps) {
  const t = await getTranslations({ locale, namespace: 'axSite.challenges' });
  return (
    <section aria-labelledby="ax-challenges-heading" className="bg-white py-16 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <h2 id="ax-challenges-heading" className={SECTION_HEADING}>
          {t('title')}
        </h2>
        <p className="mx-auto mt-5 max-w-3xl text-center font-bold leading-relaxed">{t('lead')}</p>
        {/* Subgrid rows line up the headers, problems and solutions across the four columns */}
        <ul className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4 lg:gap-y-0">
          {CHALLENGE_KEYS.map((key) => (
            <li
              key={key}
              className="flex flex-col overflow-hidden rounded-2xl bg-ax-mist lg:row-span-3 lg:grid lg:grid-rows-subgrid"
            >
              <div className="bg-ax-deep px-5 py-4 text-white">
                <p className="text-xs font-bold tracking-widest text-white/90">
                  {t(`items.${key}.label`)}
                </p>
                <h3 className="mt-1 text-lg font-bold leading-snug">{t(`items.${key}.title`)}</h3>
              </div>
              <p className="flex-1 px-5 py-4 text-sm leading-relaxed text-gray-700">
                {t(`items.${key}.body`)}
              </p>
              <div className="px-5 pb-5">
                <p className="flex items-center justify-center gap-1 text-xs font-bold text-ax-teal-dark">
                  <ArrowDown className="h-4 w-4" aria-hidden="true" />
                  {t('solutionsLabel')}
                </p>
                <ul className="mt-2 space-y-2">
                  {SOLUTION_KEYS.map((solution) => (
                    <li
                      key={solution}
                      className="rounded-lg bg-white px-4 py-3 text-sm font-bold leading-snug text-ax-teal-dark"
                    >
                      {t(`items.${key}.solutions.${solution}`)}
                    </li>
                  ))}
                </ul>
              </div>
            </li>
          ))}
        </ul>
        <div className="mt-10 rounded-2xl bg-ax-deep px-6 py-6 text-center text-white">
          <p className="text-xl font-bold sm:text-2xl">{t('band')}</p>
          <p className="mt-2 font-bold leading-relaxed">
            {t.rich('closing', {
              em: (chunks) => <em className="not-italic text-ax-yellow">{chunks}</em>,
            })}
          </p>
        </div>
      </div>
    </section>
  );
}

const STEPS = [
  { key: 'simple', icon: Gauge },
  { key: 'survey', icon: ClipboardList },
  { key: 'migration', icon: MonitorUp },
  { key: 'ax', icon: ChartNoAxesCombined },
] as const;
const STEP_POINT_KEYS = ['first', 'second', 'third'] as const;

/** Quick assessment first, then the three phases of the brochure */
export async function AxSteps({ locale }: SectionProps) {
  const t = await getTranslations({ locale, namespace: 'axSite.steps' });
  return (
    <section
      id={AX_SECTIONS.steps}
      aria-labelledby="ax-steps-heading"
      className="bg-ax-mist py-16 sm:py-24"
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <h2 id="ax-steps-heading" className={SECTION_HEADING}>
          {t('title')}
        </h2>
        <p className="mx-auto mt-5 max-w-3xl text-center font-bold leading-relaxed">{t('lead')}</p>
        <ol className="mx-auto mt-14 max-w-4xl space-y-5">
          {STEPS.map(({ key, icon: Icon }, index) => (
            <li key={key} className="relative flex gap-4 sm:gap-6">
              {index < STEPS.length - 1 && (
                // Line joining the step circles, like the brochure's phase chart
                <span
                  aria-hidden="true"
                  className="absolute -bottom-5 left-[1.625rem] top-14 w-1 bg-ax-teal/40 sm:left-[1.875rem] sm:top-16"
                />
              )}
              <span
                aria-hidden="true"
                className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-4 border-white bg-ax-deep text-white sm:h-16 sm:w-16"
              >
                <Icon className="h-6 w-6 sm:h-7 sm:w-7" />
              </span>
              <div className="flex-1 rounded-2xl bg-white p-5 shadow-sm sm:p-6 md:grid md:grid-cols-[11rem_1fr] md:gap-6">
                <div>
                  <p className="inline-block rounded bg-ax-teal-dark px-3 py-1 font-ax-latin text-xs font-bold tracking-wider text-white">
                    {t(`items.${key}.label`)}
                  </p>
                  <h3 className="mt-2 text-lg font-bold">{t(`items.${key}.title`)}</h3>
                </div>
                {key === 'simple' ? (
                  <p className="mt-3 text-sm leading-relaxed text-gray-700 md:mt-0">
                    {t(`items.${key}.body`)}
                  </p>
                ) : (
                  <ul className="mt-3 space-y-2 text-sm leading-relaxed text-gray-700 md:mt-0">
                    {STEP_POINT_KEYS.map((point) => (
                      <li key={point} className="flex gap-2">
                        <span
                          aria-hidden="true"
                          className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-ax-teal-dark"
                        />
                        <span>{t(`items.${key}.points.${point}`)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
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
      className="bg-white py-16 sm:py-24"
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
      className="bg-gradient-to-b from-white to-ax-mist py-16 sm:py-24"
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
  { key: 'speed', icon: Timer },
  { key: 'quality', icon: ShieldCheck },
  { key: 'ax', icon: Bot },
] as const;
const REASON_POINT_KEYS = ['first', 'second'] as const;

export async function AxReasons({ locale }: SectionProps) {
  const t = await getTranslations({ locale, namespace: 'axSite.reasons' });
  return (
    <section aria-labelledby="ax-reasons-heading" className="bg-ax-deep py-16 text-white sm:py-24">
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        <h2 id="ax-reasons-heading" className={SECTION_HEADING}>
          {t('title')}
        </h2>
        <ul className="mt-12 grid gap-5 md:grid-cols-3">
          {REASONS.map(({ key, icon: Icon }) => (
            <li key={key} className="overflow-hidden rounded-2xl bg-white text-ax-ink">
              <div className="flex items-center justify-center gap-3 bg-ax-teal-dark px-6 py-4 text-white">
                <Icon className="h-6 w-6" aria-hidden="true" />
                <h3 className="text-xl font-bold">{t(`items.${key}.title`)}</h3>
              </div>
              <ul className="space-y-3 p-6 text-sm leading-relaxed">
                {REASON_POINT_KEYS.map((point) => (
                  <li key={point} className="flex gap-2">
                    <Check
                      className="mt-0.5 h-4 w-4 shrink-0 text-ax-teal-dark"
                      aria-hidden="true"
                    />
                    <span>{t(`items.${key}.points.${point}`)}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs leading-relaxed text-white/90">{t('note')}</p>
        <div className="mt-10 rounded-2xl border border-white/30 p-6 text-center">
          <p className="font-bold">{t('certified.title')}</p>
          <p className="mt-2 text-sm leading-relaxed text-white/90">{t('certified.body')}</p>
        </div>
      </div>
    </section>
  );
}

const FAQ_KEYS = ['cost', 'who', 'targets', 'result', 'data', 'privacy'] as const;

export async function AxFaq({ locale }: SectionProps) {
  const t = await getTranslations({ locale, namespace: 'axSite.faq' });
  return (
    <section
      id={AX_SECTIONS.faq}
      aria-labelledby="ax-faq-heading"
      className="bg-ax-mist py-16 sm:py-24"
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
      id={AX_FINAL_SECTION_ID}
      aria-labelledby="ax-final-heading"
      className="bg-gradient-to-br from-ax-teal-dark to-ax-deep py-16 text-center text-white sm:py-20"
    >
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <h2 id="ax-final-heading" className="text-2xl font-bold leading-snug sm:text-3xl">
          {t('title')}
        </h2>
        <p className="mx-auto mt-4 max-w-2xl font-bold leading-relaxed text-white/90">
          {t('lead')}
        </p>
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
        <div className="mx-auto mt-10 max-w-2xl rounded-2xl p-6 ring-1 ring-white/40">
          <h3 className="font-bold">{t('contact.title')}</h3>
          <dl className="mt-4 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-8">
            <div className="flex items-center gap-2">
              <dt>
                <Mail className="h-5 w-5" aria-hidden="true" />
                <span className="sr-only">{t('contact.email')}</span>
              </dt>
              <dd>
                <a
                  href={`mailto:${AX_CONTACT.email}`}
                  className="font-ax-latin text-lg font-bold underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                >
                  {AX_CONTACT.email}
                </a>
              </dd>
            </div>
            <div className="flex items-center gap-2">
              <dt>
                <Phone className="h-5 w-5" aria-hidden="true" />
                <span className="sr-only">{t('contact.phone')}</span>
              </dt>
              <dd>
                <a
                  href={`tel:${AX_CONTACT.phoneE164}`}
                  className="font-ax-latin text-lg font-bold underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                >
                  {AX_CONTACT.phone}
                </a>
              </dd>
            </div>
          </dl>
          <p className="mt-4 text-sm text-white/90">
            {t('contact.department')}
            <span aria-hidden="true"> ／ </span>
            {/* Read as a pause instead of running the two items together */}
            <span className="sr-only">, </span>
            <br className="sm:hidden" />
            {t('contact.hours')}
          </p>
        </div>
      </div>
    </section>
  );
}
