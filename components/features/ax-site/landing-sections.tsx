import { AxDiagnosisFlow } from '@/components/features/ax-diagnosis/ax-diagnosis-flow';
import { allowedEmailDomains } from '@/lib/email/allowed-recipients';
import { axResultEmailEnabled } from '@/lib/features/diagnostics/ax-migration/result-email-config';
import { turnstileSiteKey } from '@/lib/features/diagnostics/turnstile';
import type { DiagnosticLocale } from '@/lib/features/diagnostics/types';
import { cn } from '@/lib/utils';
import {
  BadgeCheck,
  Bot,
  Boxes,
  ChartColumn,
  Check,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  Cpu,
  Database,
  HandCoins,
  Layers,
  Lock,
  Mail,
  MonitorSmartphone,
  Phone,
  Server,
  ShieldCheck,
  Timer,
  UserRoundX,
} from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import Image from 'next/image';
import type { ReactNode } from 'react';
import { AxCrossLink } from './ax-cross-link';
import { AxCtaLink } from './ax-cta-link';
import { AxDiagnosisFrame } from './ax-landing-view';
import {
  AX_CONSULT_BAND_ID,
  AX_CONTACT,
  AX_FINAL_SECTION_ID,
  AX_HERO_CTA_ID,
  AX_PROBLEMS_CTA_ID,
  AX_SECTIONS,
  AX_SITE_LINKS,
  axConsultationUrl,
  axPrivacyPolicyUrl,
} from './site-config';

export interface SectionProps {
  locale: DiagnosticLocale;
}

export const SECTION_HEADING = 'text-center text-2xl font-bold leading-snug sm:text-[2.25rem]';
/** Lead under a centered section heading, on white or mist */
export const SECTION_LEAD = 'mx-auto mt-5 max-w-3xl text-center leading-relaxed text-gray-700';
export const EYEBROW = 'text-center font-ax-latin text-sm font-bold tracking-[0.2em] text-ax-leaf';
/** Forest pill above a heading, as in the STUDIO design (#414) */
const BADGE =
  'inline-block rounded-full bg-ax-forest px-8 py-1.5 text-sm font-bold text-white sm:text-base';

/** "＼ … ／" frames the caption in Japanese; screen readers skip the marks */
export function CtaCaption({
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

const DEADLINE_KEYS = ['lease', 'people', 'edi'] as const;

export async function AxHero({ locale }: SectionProps) {
  const t = await getTranslations({ locale, namespace: 'axSite.hero' });
  const common = await getTranslations({ locale, namespace: 'axSite' });

  return (
    <section aria-labelledby="ax-hero-heading" className="overflow-hidden bg-ax-forest text-white">
      <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-14 sm:px-6 md:py-20 lg:grid-cols-[1fr_1fr]">
        <div className="space-y-6">
          {/* Who it is for, ahead of the question in the heading */}
          <p className="text-sm font-bold tracking-wider text-ax-neon">{t('eyebrow')}</p>
          <h1
            id="ax-hero-heading"
            className="text-[1.75rem] font-bold leading-snug sm:text-4xl lg:text-[2.6rem] lg:leading-[1.35]"
          >
            {t('title')}
          </h1>
          <p className="text-lg font-bold">{t('tagline')}</p>
          <p className="leading-relaxed text-white/90">{t('lead')}</p>
          {/* Deadlines and people: what makes a renewal urgent, ahead of the check (#420) */}
          <div>
            <p className="text-sm font-bold text-white/90">{t('deadlinesLabel')}</p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {DEADLINE_KEYS.map((key) => (
                <li
                  key={key}
                  className="rounded border border-white/60 px-3 py-1.5 text-sm font-bold leading-snug"
                >
                  {t(`deadlines.${key}`)}
                </li>
              ))}
            </ul>
          </div>
          <div id={AX_HERO_CTA_ID} className="space-y-3 pt-2">
            <CtaCaption locale={locale}>{t('ctaCaption')}</CtaCaption>
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <AxCtaLink href={`#${AX_SECTIONS.diagnosis}`} location="hero" tone="dark">
                {t('cta')}
              </AxCtaLink>
              <AxCtaLink
                href={AX_SITE_LINKS.demo}
                variant="demo"
                location="hero"
                tone="dark"
                external
                newTabLabel={common('newTab')}
              >
                {t('demo')}
              </AxCtaLink>
            </div>
          </div>
        </div>
        <Image
          src="/images/ax-migration/hero.webp"
          alt={t('imageAlt')}
          width={1168}
          height={771}
          sizes="(min-width: 1152px) 552px, (min-width: 1024px) 48vw, 100vw"
          priority
          className="mx-auto h-auto w-full max-w-xl"
        />
      </div>
    </section>
  );
}

const OVERVIEW_KEYS = ['survey', 'migration', 'ax'] as const;

/** The three phases at a glance, before the concerns (#414) */
export async function AxOverview({ locale }: SectionProps) {
  const t = await getTranslations({ locale, namespace: 'axSite.overview' });
  const steps = await getTranslations({ locale, namespace: 'axSite.steps.items' });
  return (
    <section aria-labelledby="ax-overview-heading" className="bg-white py-16 sm:py-24">
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        <h2 id="ax-overview-heading" className={SECTION_HEADING}>
          {t('title')}
        </h2>
        <p className={SECTION_LEAD}>{t('lead')}</p>
        <ol className="mt-12 grid gap-12 md:grid-cols-3 md:gap-14">
          {OVERVIEW_KEYS.map((key, index) => (
            <li
              key={key}
              className="relative flex flex-col items-center justify-center bg-ax-cloud px-6 py-10 text-center"
            >
              <p className="font-ax-latin text-lg font-bold">
                {t('stepLabel', { number: index + 1 })}
              </p>
              <h3 className="mt-2 text-lg font-bold">{steps(`${key}.title`)}</h3>
              <p className="mt-3 text-sm leading-relaxed text-gray-700">{t(`items.${key}`)}</p>
              {index < OVERVIEW_KEYS.length - 1 && (
                <>
                  <ChevronRight
                    aria-hidden="true"
                    className="absolute -right-11 top-1/2 hidden h-8 w-8 -translate-y-1/2 md:block"
                  />
                  <ChevronDown
                    aria-hidden="true"
                    className="absolute -bottom-11 left-1/2 h-8 w-8 -translate-x-1/2 md:hidden"
                  />
                </>
              )}
            </li>
          ))}
        </ol>
        <p className="mt-14 text-center text-xl font-bold sm:text-2xl">{t('closing')}</p>
      </div>
    </section>
  );
}

const CHALLENGES = [
  { key: 'people', icon: UserRoundX },
  { key: 'agility', icon: MonitorSmartphone },
  { key: 'cost', icon: HandCoins },
  { key: 'data', icon: ChartColumn },
] as const;
const SOLUTION_KEYS = ['first', 'second'] as const;

/** Brochure: the four challenges (people, things, money, information) and what AX migration brings */
export async function AxChallenges({ locale }: SectionProps) {
  const t = await getTranslations({ locale, namespace: 'axSite.challenges' });
  const problems = await getTranslations({ locale, namespace: 'axSite.problems' });
  return (
    <section
      id={AX_SECTIONS.problems}
      aria-labelledby="ax-challenges-heading"
      className="bg-ax-mist py-16 sm:py-24"
    >
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        <div className="text-center">
          <p className={BADGE}>{problems('title')}</p>
        </div>
        <h2 id="ax-challenges-heading" className={`mt-5 ${SECTION_HEADING}`}>
          {t('title')}
        </h2>
        <p className={SECTION_LEAD}>{t('lead')}</p>
        <ul className="mt-12 grid gap-6 sm:grid-cols-2">
          {CHALLENGES.map(({ key, icon: Icon }) => (
            <li key={key} className="flex flex-col bg-white p-6 sm:p-8">
              <p className="flex items-start gap-3 border-b border-gray-200 pb-4 font-bold leading-snug">
                <span className="shrink-0 rounded bg-ax-cloud px-2 py-0.5 text-sm">
                  {t('nowLabel')}
                </span>
                <span>「{t(`items.${key}.voice`)}」</span>
              </p>
              <div className="mt-4 flex items-center gap-3">
                <Icon className="h-10 w-10 text-ax-forest" aria-hidden="true" />
                <p className="text-sm font-bold text-ax-leaf">{t(`items.${key}.label`)}</p>
              </div>
              <h3 className="mt-4 text-lg font-bold leading-snug">{t(`items.${key}.title`)}</h3>
              <p className="mt-3 flex-1 text-sm leading-relaxed text-gray-700">
                {t(`items.${key}.body`)}
              </p>
              <div className="mt-6 rounded bg-ax-leaf/10 p-4">
                <p className="text-sm font-bold text-ax-leaf">{t('solutionsLabel')}</p>
                <ul className="mt-3 space-y-2">
                  {SOLUTION_KEYS.map((solution) => (
                    <li key={solution} className="flex gap-2 font-bold leading-snug">
                      <CircleCheck
                        className="mt-0.5 h-5 w-5 shrink-0 text-ax-leaf"
                        aria-hidden="true"
                      />
                      <span>{t(`items.${key}.solutions.${solution}`)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </li>
          ))}
        </ul>
        <div
          id={AX_PROBLEMS_CTA_ID}
          className="mx-auto mt-10 max-w-3xl rounded-lg bg-white px-6 py-6 text-center"
        >
          <p className="font-bold leading-relaxed">{problems('bridge')}</p>
          <AxCtaLink href={`#${AX_SECTIONS.diagnosis}`} location="problems" className="mt-4">
            {problems('bridgeCta')}
          </AxCtaLink>
        </div>
        <div className="mt-14 text-center">
          <p className="leading-relaxed text-gray-700">{t('hesitation')}</p>
          <p className="mt-3 text-xl font-bold sm:text-2xl">{t('answer')}</p>
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

/** Three strengths, each answering one concern: time, the impact on operations, the return */
export async function AxReasons({ locale }: SectionProps) {
  const t = await getTranslations({ locale, namespace: 'axSite.reasons' });
  return (
    <section
      id={AX_SECTIONS.reasons}
      aria-labelledby="ax-reasons-heading"
      className="bg-white py-16 sm:py-24"
    >
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        <h2 id="ax-reasons-heading" className={SECTION_HEADING}>
          {t('title')}
        </h2>
        <p className="mt-4 text-center text-lg font-bold">{t('tagline')}</p>
        <p className={SECTION_LEAD}>{t('lead')}</p>
        <ul className="mt-16 grid gap-10 md:grid-cols-3 md:gap-6">
          {REASONS.map(({ key, icon: Icon }, index) => (
            <li
              key={key}
              className="relative flex flex-col bg-ax-cloud p-6 pt-10 text-center sm:p-8 sm:pt-12"
            >
              <span
                aria-hidden="true"
                className="absolute left-1/2 top-0 flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-ax-forest font-ax-latin text-lg font-bold text-white"
              >
                {String(index + 1).padStart(2, '0')}
              </span>
              <p className="text-sm text-gray-700">{t(`items.${key}.concern`)}</p>
              <Icon className="mx-auto mt-6 h-12 w-12 text-ax-forest" aria-hidden="true" />
              <h3 className="mt-4 text-xl font-bold">{t(`items.${key}.title`)}</h3>
              <p className="mt-3 font-bold leading-snug">{t(`items.${key}.points.first`)}</p>
              <p className="mt-4 text-sm leading-relaxed text-gray-700">
                {t(`items.${key}.points.second`)}
              </p>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs leading-relaxed text-gray-600">{t('note')}</p>
      </div>
    </section>
  );
}

/** Order entry screen before and after the migration, on a separate site (#414) */
export async function AxDemo({ locale }: SectionProps) {
  const t = await getTranslations({ locale, namespace: 'axSite.demo' });
  const common = await getTranslations({ locale, namespace: 'axSite' });
  return (
    <section
      id={AX_SECTIONS.demo}
      aria-labelledby="ax-demo-heading"
      className="overflow-hidden bg-ax-forest py-16 text-white sm:py-24"
    >
      <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 sm:px-6 lg:grid-cols-2">
        <div>
          <p className="inline-block rounded-full border-2 border-ax-neon px-5 py-1 text-sm font-bold text-ax-neon">
            {t('eyebrow')}
          </p>
          <h2
            id="ax-demo-heading"
            className="mt-5 text-2xl font-bold leading-snug sm:text-[2.25rem]"
          >
            {t('title')}
          </h2>
          <p className="mt-5 leading-relaxed text-white/90">{t('lead')}</p>
          <AxCtaLink
            href={AX_SITE_LINKS.demo}
            variant="demo"
            location="demo"
            tone="dark"
            external
            newTabLabel={common('newTab')}
            className="mt-8"
          >
            {t('cta')}
          </AxCtaLink>
        </div>
        <Image
          src="/images/ax-migration/demo.webp"
          alt={t('imageAlt')}
          width={1119}
          height={863}
          sizes="(min-width: 1152px) 552px, (min-width: 1024px) 48vw, 100vw"
          className="mx-auto h-auto w-full max-w-lg"
        />
      </div>
    </section>
  );
}

const STEPS = ['web', 'consult', 'simple', 'survey', 'migration', 'ax'] as const;
const STEP_POINT_KEYS = ['first', 'second', 'third'] as const;

/** The free web check and the quick assessment first, then the three phases of the brochure */
export async function AxSteps({ locale }: SectionProps) {
  const t = await getTranslations({ locale, namespace: 'axSite.steps' });
  return (
    <section
      id={AX_SECTIONS.steps}
      aria-labelledby="ax-steps-heading"
      className="bg-ax-mist py-16 sm:py-24"
    >
      <div className="mx-auto grid max-w-6xl gap-10 px-4 sm:px-6 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
        <div className="lg:sticky lg:top-24 lg:self-start">
          <h2 id="ax-steps-heading" className="text-2xl font-bold leading-snug sm:text-[2.25rem]">
            {t('title')}
          </h2>
          <p className="mt-5 text-sm leading-loose text-gray-700">{t('lead')}</p>
          <p className="mt-5 text-sm font-bold leading-relaxed">{t('note')}</p>
        </div>
        <ol>
          {STEPS.map((key, index) => (
            <li key={key} className="relative pb-10 pl-12 last:pb-0">
              {index < STEPS.length - 1 && (
                // Line joining the step marks, like the phase chart of the STUDIO design
                <span
                  aria-hidden="true"
                  className="absolute bottom-0 left-4 top-9 w-px bg-ax-ink/50"
                />
              )}
              <span
                aria-hidden="true"
                className="absolute left-0 top-0 flex h-8 w-8 items-center justify-center rounded-full border border-ax-ink bg-white"
              >
                <Check className="h-4 w-4" />
              </span>
              <p className="font-ax-latin text-sm font-bold text-ax-leaf">
                {t(`items.${key}.label`)}
              </p>
              <h3 className="mt-1 text-lg font-bold">{t(`items.${key}.title`)}</h3>
              {key === 'web' || key === 'consult' || key === 'simple' ? (
                <p className="mt-3 text-sm leading-relaxed text-gray-700">
                  {t(`items.${key}.body`)}
                </p>
              ) : (
                <ul className="mt-3 space-y-1.5 text-sm leading-relaxed text-gray-700">
                  {STEP_POINT_KEYS.map((point) => (
                    <li key={point} className="flex gap-2">
                      <span aria-hidden="true">・</span>
                      <span>{t(`items.${key}.points.${point}`)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
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
        <p className="mx-auto mt-5 max-w-2xl text-center leading-relaxed text-gray-700">
          {t('lead')}
        </p>
        <ul className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {TARGETS.map(({ key, icon: Icon }) => (
            <li key={key} className="flex flex-col bg-ax-cloud p-6">
              <span className="flex h-12 w-12 items-center justify-center rounded-md bg-ax-forest text-white">
                <Icon className="h-6 w-6" aria-hidden="true" />
              </span>
              <h3 className="mt-4 text-lg font-bold">{t(`items.${key}.name`)}</h3>
              <p className="mt-2 text-sm leading-relaxed text-gray-700">{t(`items.${key}.body`)}</p>
              {key === 'access' && (
                // A fact with its date, not a countdown (#288)
                <div className="mt-4 rounded-md bg-white p-3 text-sm leading-relaxed">
                  <p>{t('accessSupport.body')}</p>
                  {/* Diagnosed here, on the Access questions (#332); the Access page is for
                      readers who want the details first */}
                  <AxCtaLink
                    href={`#${AX_SECTIONS.diagnosis}`}
                    location="targets-access"
                    platform="access"
                    className="mt-3 w-full px-4 py-3 text-sm"
                  >
                    {t('accessSupport.link')}
                  </AxCtaLink>
                  <AxCrossLink
                    href={`/${locale}/ax-migration/access`}
                    placement="targets-access"
                    className="mt-2 inline-block rounded py-1 font-bold text-ax-leaf underline underline-offset-2 focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ax-forest"
                  >
                    {t('accessSupport.page')}
                  </AxCrossLink>
                </div>
              )}
            </li>
          ))}
        </ul>
        <p className="mt-10 text-center text-sm font-bold text-ax-leaf">{t('industries')}</p>
      </div>
    </section>
  );
}

const HOST_PLATFORMS = [
  { key: 'as400', icon: Server },
  { key: 'acos', icon: Cpu },
] as const;
const HOST_POINT_KEYS = ['deadline', 'people', 'edi', 'assets'] as const;

/**
 * One section per host platform, each with its own heading for readers (and searches) of that
 * platform (#311). Its button starts the embedded diagnosis on the platform's questions.
 */
export async function AxHostPlatforms({ locale }: SectionProps) {
  const t = await getTranslations({ locale, namespace: 'axSite.hosts' });
  return (
    <div className="bg-ax-mist py-16 sm:py-24">
      <div className="mx-auto grid max-w-6xl gap-6 px-4 sm:px-6 lg:grid-cols-2">
        {HOST_PLATFORMS.map(({ key, icon: Icon }) => (
          <section
            key={key}
            id={AX_SECTIONS[key]}
            aria-labelledby={`ax-${key}-heading`}
            className="flex flex-col bg-white p-6 sm:p-8"
          >
            <div className="flex items-center gap-3">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-ax-forest text-white">
                <Icon className="h-6 w-6" aria-hidden="true" />
              </span>
              <h2 id={`ax-${key}-heading`} className="text-xl font-bold leading-snug sm:text-2xl">
                {t(`${key}.title`)}
              </h2>
            </div>
            <p className="mt-4 leading-relaxed text-gray-700">{t(`${key}.lead`)}</p>
            <ul className="mt-5 flex-1 space-y-4">
              {HOST_POINT_KEYS.map((point) => (
                <li key={point} className="flex gap-3">
                  <CircleCheck
                    className="mt-0.5 h-5 w-5 shrink-0 text-ax-leaf"
                    aria-hidden="true"
                  />
                  <p className="text-sm leading-relaxed">
                    <span className="block font-bold">{t(`${key}.points.${point}.label`)}</span>
                    {t(`${key}.points.${point}.body`)}
                  </p>
                </li>
              ))}
            </ul>
            <AxCtaLink
              href={`#${AX_SECTIONS.diagnosis}`}
              location={key}
              platform={key}
              className="mt-8 self-center"
            >
              {t(`${key}.cta`)}
            </AxCtaLink>
          </section>
        ))}
      </div>
    </div>
  );
}

const TRUST = [
  { key: 'security', icon: Lock },
  { key: 'scope', icon: Boxes },
  { key: 'certified', icon: BadgeCheck },
] as const;

/** Reassurance right before the diagnosis asks for contact details */
export async function AxTrust({ locale }: SectionProps) {
  const t = await getTranslations({ locale, namespace: 'axSite.trust' });
  return (
    <section aria-labelledby="ax-trust-heading" className="bg-white py-16 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <h2 id="ax-trust-heading" className={SECTION_HEADING}>
          {t('title')}
        </h2>
        <ul className="mt-12 grid gap-8 md:grid-cols-3">
          {TRUST.map(({ key, icon: Icon }) => (
            <li key={key} className="flex gap-4">
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md bg-ax-cloud text-ax-forest">
                <Icon className="h-6 w-6" aria-hidden="true" />
              </span>
              <div>
                <h3 className="font-bold">{t(`items.${key}.title`)}</h3>
                <p className="mt-2 text-sm leading-relaxed text-gray-700">
                  {t(`items.${key}.body`)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

interface DiagnosisIntroProps {
  eyebrow: string;
  title: string;
  lead: string;
  /** Under the lead, e.g. how to leave the path the diagnosis starts on */
  children?: ReactNode;
}

/** Eyebrow, heading and lead above the embedded diagnosis of a landing page */
export function DiagnosisIntro({ eyebrow, title, lead, children }: DiagnosisIntroProps) {
  return (
    <>
      {/* Small, so the first question is on screen right after a jump here */}
      <p aria-hidden="true" className={EYEBROW}>
        {eyebrow}
      </p>
      <h2 id="ax-diagnosis-heading" className={`mt-2 ${SECTION_HEADING}`}>
        {title}
      </h2>
      <p className="mx-auto mt-5 max-w-2xl text-center leading-relaxed text-gray-700">{lead}</p>
      {children}
    </>
  );
}

export async function AxDiagnosisSection({ locale }: SectionProps) {
  const t = await getTranslations({ locale, namespace: 'axSite.diagnosis' });
  return (
    <AxDiagnosisFrame
      intro={<DiagnosisIntro eyebrow={t('eyebrow')} title={t('title')} lead={t('lead')} />}
    >
      <AxDiagnosisFlow
        locale={locale}
        privacyPolicyUrl={axPrivacyPolicyUrl()}
        turnstileSiteKey={turnstileSiteKey()}
        allowedEmailDomains={allowedEmailDomains()}
        resultEmailEnabled={axResultEmailEnabled()}
        embedded
        entry="ax-lp"
      />
    </AxDiagnosisFrame>
  );
}

const FAQ_KEYS: readonly string[] = [
  'cost',
  'who',
  'targets',
  'costTime',
  'partial',
  'prepare',
  'vendorSource',
  'result',
  'ax',
  'data',
  'privacy',
];

interface FaqProps extends SectionProps {
  /** Messages with `title` and `items.<key>.q` / `.a` (another landing page has its own) */
  namespace?: string;
  keys?: readonly string[];
}

export async function AxFaq({ locale, namespace = 'axSite.faq', keys = FAQ_KEYS }: FaqProps) {
  const t = await getTranslations({ locale, namespace });
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
        <div className="mt-10 border-b border-gray-300">
          {keys.map((key) => (
            <details key={key} className="group border-t border-gray-300 py-5">
              <summary className="flex cursor-pointer list-none items-start justify-between gap-4 font-bold [&::-webkit-details-marker]:hidden">
                <span className="flex gap-3">
                  <span aria-hidden="true" className="font-ax-latin text-ax-forest">
                    Q
                  </span>
                  {t(`items.${key}.q`)}
                </span>
                <ChevronDown
                  className="mt-0.5 h-5 w-5 shrink-0 group-open:rotate-180 motion-safe:transition-transform"
                  aria-hidden="true"
                />
              </summary>
              <p className="mt-4 rounded-md bg-white p-4 text-sm leading-relaxed text-gray-700 sm:ml-7">
                {t(`items.${key}.a`)}
              </p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

interface FinalCtaProps extends SectionProps {
  /** Messages for the title, lead, caption and buttons; the contact details stay the site's */
  copyNamespace?: string;
  /** Prefix of the analytics locations (e.g. 'access-' gives 'access-final') */
  locationPrefix?: string;
}

interface ContactBandProps extends SectionProps {
  id: string;
  headingId: string;
  title: string;
  lead: string;
  caption?: string;
  cta: string;
  consult?: string;
  location: string;
}

const CONTACT_LINK =
  'inline-flex min-h-11 items-center gap-2 font-ax-latin font-bold underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white';

/**
 * Forest band with the diagnosis and the phone, repeated down the page like the consultation
 * bands of the reference site (#420): readers who would rather call find the number on the way
 */
async function ContactBand({
  locale,
  id,
  headingId,
  title,
  lead,
  caption,
  cta,
  consult,
  location,
}: ContactBandProps) {
  const t = await getTranslations({ locale, namespace: 'axSite.finalCta' });
  const common = await getTranslations({ locale, namespace: 'axSite' });
  const consultationUrl = axConsultationUrl();
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className="bg-ax-forest py-14 text-center text-white sm:py-20"
    >
      <div className="mx-auto max-w-4xl px-4 sm:px-6">
        <h2 id={headingId} className="text-2xl font-bold leading-snug sm:text-[2rem]">
          {title}
        </h2>
        <p className="mx-auto mt-4 max-w-2xl leading-relaxed text-white/90">{lead}</p>
        {caption && (
          <CtaCaption locale={locale} className="mt-8">
            {caption}
          </CtaCaption>
        )}
        <div
          className={cn(
            'flex flex-col items-center justify-center gap-3 sm:flex-row',
            caption ? 'mt-3' : 'mt-8'
          )}
        >
          <AxCtaLink href={`#${AX_SECTIONS.diagnosis}`} location={location} tone="dark">
            {cta}
          </AxCtaLink>
          {consultationUrl && consult && (
            <AxCtaLink
              href={consultationUrl}
              variant="consultation"
              location={location}
              tone="dark"
              external
              newTabLabel={common('newTab')}
            >
              {consult}
            </AxCtaLink>
          )}
        </div>
        <dl className="mt-8 flex flex-col items-center justify-center gap-x-8 gap-y-1 sm:flex-row">
          <div className="flex items-center gap-2">
            <dt>
              <Phone className="h-5 w-5" aria-hidden="true" />
              <span className="sr-only">{t('contact.phone')}</span>
            </dt>
            <dd>
              <a href={`tel:${AX_CONTACT.phoneE164}`} className={`${CONTACT_LINK} text-xl`}>
                {AX_CONTACT.phone}
              </a>
            </dd>
          </div>
          <div className="flex items-center gap-2">
            <dt>
              <Mail className="h-5 w-5" aria-hidden="true" />
              <span className="sr-only">{t('contact.email')}</span>
            </dt>
            <dd>
              <a href={`mailto:${AX_CONTACT.email}`} className={`${CONTACT_LINK} text-lg`}>
                {AX_CONTACT.email}
              </a>
            </dd>
          </div>
        </dl>
        <p className="mt-2 text-sm text-white/90">
          {t('contact.department')}
          <span aria-hidden="true"> ／ </span>
          {/* Read as a pause instead of running the two items together */}
          <span className="sr-only">, </span>
          <br className="sm:hidden" />
          {t('contact.hours')}
        </p>
      </div>
    </section>
  );
}

interface ConsultBandProps extends SectionProps {
  /** Messages with the button label `cta` (the Access page names its own diagnosis) */
  ctaNamespace?: string;
  /** Prefix of the analytics location (e.g. 'access-' gives 'access-consult-band') */
  locationPrefix?: string;
}

/** Consultation band in the middle of the page, after the steps (#420) */
export async function AxConsultBand({
  locale,
  ctaNamespace = 'axSite.finalCta',
  locationPrefix = '',
}: ConsultBandProps) {
  const t = await getTranslations({ locale, namespace: 'axSite.consultBand' });
  const button = await getTranslations({ locale, namespace: ctaNamespace });
  return (
    <ContactBand
      locale={locale}
      id={AX_CONSULT_BAND_ID}
      headingId="ax-consult-heading"
      title={t('title')}
      lead={t('lead')}
      cta={button('cta')}
      location={`${locationPrefix}consult-band`}
    />
  );
}

export async function AxFinalCta({ locale, copyNamespace, locationPrefix = '' }: FinalCtaProps) {
  const t = await getTranslations({ locale, namespace: 'axSite.finalCta' });
  const copy = copyNamespace ? await getTranslations({ locale, namespace: copyNamespace }) : t;
  return (
    <ContactBand
      locale={locale}
      id={AX_FINAL_SECTION_ID}
      headingId="ax-final-heading"
      title={copy('title')}
      lead={copy('lead')}
      caption={copy('caption')}
      cta={copy('cta')}
      consult={copy('consult')}
      location={`${locationPrefix}final`}
    />
  );
}
