import { AxDiagnosisFlow } from '@/components/features/ax-diagnosis/ax-diagnosis-flow';
import { allowedEmailDomains } from '@/lib/email/allowed-recipients';
import { columnPath, columnsFor } from '@/lib/features/ax-site/columns';
import { turnstileSiteKey } from '@/lib/features/diagnostics/turnstile';
import {
  ArrowRight,
  Check,
  CirclePause,
  ClipboardList,
  Globe,
  HardDrive,
  Info,
  MonitorUp,
  Package,
  Route,
  ShieldOff,
  Sparkles,
  UserRound,
  Wrench,
} from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { AxCtaLink } from './ax-cta-link';
import { AxDiagnosisFrame } from './ax-landing-view';
import { CtaCaption, EYEBROW, SECTION_HEADING, type SectionProps } from './landing-sections';
import {
  AX_PROBLEMS_CTA_ID,
  AX_SECTIONS,
  axConsultationUrl,
  axPrivacyPolicyUrl,
} from './site-config';

/**
 * Sections of the Access landing page (#296). It shares the frame, the header anchors
 * (AX_SECTIONS) and the look of the main landing page; the copy lives in `axAccess`.
 */

const PATHS = [
  { key: 'fix', icon: Wrench },
  { key: 'web', icon: Globe },
  { key: 'replace', icon: Package },
] as const;

export async function AxAccessHero({ locale }: SectionProps) {
  const t = await getTranslations({ locale, namespace: 'axAccess.hero' });
  const consultationUrl = axConsultationUrl();

  return (
    <section aria-labelledby="ax-hero-heading" className="relative overflow-hidden bg-white">
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-14 sm:px-6 md:py-20 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="space-y-6">
          <p className="text-sm font-bold tracking-wider text-ax-teal-dark">{t('eyebrow')}</p>
          <h1
            id="ax-hero-heading"
            className="text-[1.75rem] font-bold leading-snug sm:text-4xl lg:text-[2.6rem] lg:leading-[1.35]"
          >
            {t('title')}
          </h1>
          <p className="font-bold leading-relaxed">{t('lead')}</p>
          <div className="space-y-3 pt-2">
            <CtaCaption locale={locale}>{t('ctaCaption')}</CtaCaption>
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <AxCtaLink href={`#${AX_SECTIONS.diagnosis}`} location="access-hero">
                {t('cta')}
              </AxCtaLink>
              {consultationUrl && (
                <AxCtaLink
                  href={consultationUrl}
                  variant="consultation"
                  location="access-hero"
                  external
                >
                  {t('consult')}
                </AxCtaLink>
              )}
            </div>
            <p className="text-sm leading-relaxed text-gray-700">{t('pdfNote')}</p>
          </div>
        </div>

        <div className="relative mx-auto w-full max-w-md">
          {/* Decorative glow in the site's lime-to-teal gradient */}
          <div
            aria-hidden="true"
            className="absolute -inset-6 rounded-[3rem] bg-gradient-to-br from-ax-lime to-ax-teal opacity-30 blur-2xl"
          />
          <div className="relative space-y-3 rounded-3xl bg-white p-6 shadow-[0_12px_40px_rgba(0,0,0,0.12)] ring-1 ring-black/5">
            <p className="text-sm font-bold text-ax-teal-dark">{t('paths.title')}</p>
            <ul className="space-y-3">
              {PATHS.map(({ key, icon: Icon }) => (
                <li key={key} className="flex items-center gap-3 rounded-2xl bg-ax-mist p-4">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-ax-teal text-white">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <span className="font-bold">{t(`paths.${key}`)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

const SUPPORT_KEYS = ['le2013', 'v2016', 'v2021', 'm365'] as const;
/** Microsoft lifecycle pages the support-end facts come from */
const SUPPORT_SOURCES = [
  'https://learn.microsoft.com/lifecycle/products/office-ltsc-2021',
  'https://support.microsoft.com/KB/5002369',
] as const;

/** Facts with their source and date; no countdown (#158) */
export async function AxAccessSupportEnd({ locale }: SectionProps) {
  const t = await getTranslations({ locale, namespace: 'axAccess.supportEnd' });
  // The articles on the subject, in the page's language only (they are Japanese for now, #324)
  const columns = columnsFor('access').filter((column) => column.locale === locale);
  return (
    <section aria-labelledby="ax-access-support-heading" className="bg-ax-mist py-12 sm:py-16">
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <div className="rounded-2xl bg-white p-6 shadow-sm sm:p-8">
          <h2
            id="ax-access-support-heading"
            className="flex items-center gap-2 text-xl font-bold sm:text-2xl"
          >
            <Info className="h-6 w-6 shrink-0 text-ax-teal-dark" aria-hidden="true" />
            {t('title')}
          </h2>
          <ul className="mt-5 space-y-2">
            {SUPPORT_KEYS.map((key) => (
              <li key={key} className="flex gap-2 font-bold leading-relaxed">
                <span
                  aria-hidden="true"
                  className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-ax-teal-dark"
                />
                <span>{t(`items.${key}`)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 leading-relaxed text-gray-700">{t('body')}</p>
          <p className="mt-4 text-xs text-gray-600">
            {t('source')}
            {SUPPORT_SOURCES.map((href, index) => (
              <a
                key={href}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-2 underline underline-offset-2"
              >
                {t('sourceLink', { number: index + 1 })}
              </a>
            ))}
          </p>
          {columns.length > 0 && (
            <div className="mt-6 border-t border-gray-200 pt-4">
              <p className="text-sm font-bold text-ax-teal-dark">{t('relatedColumn')}</p>
              <ul className="mt-2 space-y-2">
                {columns.map((column) => (
                  <li key={column.slug}>
                    <a
                      href={`/${column.locale}${columnPath(column.slug)}`}
                      className="inline-flex items-start gap-1 font-bold leading-relaxed underline underline-offset-4 hover:text-ax-teal-dark"
                    >
                      {column.title}
                      <ArrowRight className="mt-1.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

const PROBLEM_KEYS = ['m365', 'nobody', 'stability', 'remote', 'excel', 'control'] as const;

export async function AxAccessProblems({ locale }: SectionProps) {
  const t = await getTranslations({ locale, namespace: 'axAccess.problems' });
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

const RISKS = [
  { key: 'stop', icon: CirclePause },
  { key: 'support', icon: ShieldOff },
  { key: 'person', icon: UserRound },
  { key: 'data', icon: HardDrive },
] as const;

/** Moderate on purpose: never claims that moving to the web makes the data safe (#158) */
export async function AxAccessRisks({ locale }: SectionProps) {
  const t = await getTranslations({ locale, namespace: 'axAccess.risks' });
  return (
    <section aria-labelledby="ax-access-risks-heading" className="bg-white py-16 sm:py-24">
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        <h2 id="ax-access-risks-heading" className={SECTION_HEADING}>
          {t('title')}
        </h2>
        <p className="mx-auto mt-5 max-w-3xl text-center font-bold leading-relaxed">{t('lead')}</p>
        <ul className="mt-12 grid gap-5 sm:grid-cols-2">
          {RISKS.map(({ key, icon: Icon }) => (
            <li key={key} className="flex gap-4 rounded-2xl bg-ax-mist p-6">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-ax-deep text-white">
                <Icon className="h-6 w-6" aria-hidden="true" />
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
        <p className="mt-8 text-center text-sm font-bold">{t('note')}</p>
      </div>
    </section>
  );
}

/** Cases each way fits, as many as the messages have */
const PATH_FITS = {
  fix: ['a', 'b', 'c', 'd'],
  web: ['a', 'b', 'c', 'd'],
  replace: ['a', 'b'],
} as const;

/** The three ways, compared honestly: the diagnosis points at the one that fits */
export async function AxAccessPaths({ locale }: SectionProps) {
  const t = await getTranslations({ locale, namespace: 'axAccess.paths' });
  return (
    <section aria-labelledby="ax-access-paths-heading" className="bg-ax-mist py-16 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <h2 id="ax-access-paths-heading" className={SECTION_HEADING}>
          {t('title')}
        </h2>
        <p className="mx-auto mt-5 max-w-3xl text-center font-bold leading-relaxed">{t('lead')}</p>
        <ul className="mt-12 grid gap-5 md:grid-cols-3">
          {PATHS.map(({ key, icon: Icon }) => (
            <li key={key} className="flex flex-col overflow-hidden rounded-2xl bg-white shadow-sm">
              <div className="flex items-center gap-3 bg-ax-teal-dark px-6 py-4 text-white">
                <Icon className="h-6 w-6 shrink-0" aria-hidden="true" />
                <h3 className="text-lg font-bold">{t(`items.${key}.title`)}</h3>
              </div>
              <div className="flex-1 space-y-4 p-6">
                <p className="text-sm leading-relaxed text-gray-700">{t(`items.${key}.body`)}</p>
                <div>
                  <p className="text-xs font-bold text-ax-teal-dark">{t('fitLabel')}</p>
                  <ul className="mt-2 space-y-2 text-sm leading-relaxed">
                    {PATH_FITS[key].map((fit) => (
                      <li key={fit} className="flex gap-2">
                        <Check
                          className="mt-0.5 h-4 w-4 shrink-0 text-ax-teal-dark"
                          aria-hidden="true"
                        />
                        <span>{t(`items.${key}.fits.${fit}`)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-8 text-center text-sm font-bold">{t('fixNote')}</p>
        {/* The phone CTA bar stays hidden next to this button, as below the concerns of the main page */}
        <div id={AX_PROBLEMS_CTA_ID} className="mt-8 text-center">
          <AxCtaLink href={`#${AX_SECTIONS.diagnosis}`} location="access-paths">
            {t('bridgeCta')}
          </AxCtaLink>
        </div>
      </div>
    </section>
  );
}

const STEPS = [
  { key: 'inventory', icon: ClipboardList },
  { key: 'decide', icon: Route },
  { key: 'migrate', icon: MonitorUp },
  { key: 'ax', icon: Sparkles },
] as const;

export async function AxAccessSteps({ locale }: SectionProps) {
  const t = await getTranslations({ locale, namespace: 'axAccess.steps' });
  return (
    <section
      id={AX_SECTIONS.steps}
      aria-labelledby="ax-steps-heading"
      className="bg-white py-16 sm:py-24"
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <h2 id="ax-steps-heading" className={SECTION_HEADING}>
          {t('title')}
        </h2>
        <ol className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map(({ key, icon: Icon }) => (
            <li key={key} className="flex flex-col rounded-2xl bg-ax-mist p-6">
              <div className="flex items-center gap-3">
                <span
                  aria-hidden="true"
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-4 border-white bg-ax-deep text-white"
                >
                  <Icon className="h-5 w-5" />
                </span>
                <p className="inline-block rounded bg-ax-teal-dark px-3 py-1 font-ax-latin text-xs font-bold tracking-wider text-white">
                  {t(`items.${key}.label`)}
                </p>
              </div>
              <h3 className="mt-4 text-lg font-bold">{t(`items.${key}.title`)}</h3>
              <p className="mt-2 text-sm leading-relaxed text-gray-700">{t(`items.${key}.body`)}</p>
            </li>
          ))}
        </ol>
        <p className="mx-auto mt-8 max-w-3xl rounded-2xl border border-ax-teal/40 px-6 py-4 text-center text-sm leading-relaxed">
          {t('aiNote')}
        </p>
      </div>
    </section>
  );
}

const TARGET_KEYS = ['files', 'versions', 'vba', 'links', 'department'] as const;

export async function AxAccessTargets({ locale }: SectionProps) {
  const t = await getTranslations({ locale, namespace: 'axAccess.targets' });
  return (
    <section
      id={AX_SECTIONS.targets}
      aria-labelledby="ax-targets-heading"
      className="bg-ax-deep py-16 text-white sm:py-24"
    >
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <h2 id="ax-targets-heading" className={SECTION_HEADING}>
          {t('title')}
        </h2>
        <p className="mt-5 text-center font-bold leading-relaxed">{t('lead')}</p>
        <ul className="mt-10 space-y-3">
          {TARGET_KEYS.map((key) => (
            <li
              key={key}
              className="flex items-start gap-3 rounded-2xl bg-white px-5 py-4 font-bold text-ax-ink"
            >
              <Check className="mt-0.5 h-5 w-5 shrink-0 text-ax-teal-dark" aria-hidden="true" />
              <span>{t(`items.${key}`)}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export const ACCESS_FAQ_KEYS = [
  'noDocs',
  'accde',
  'partial',
  'cost',
  'period',
  'useDuring',
  'department',
  'consult',
] as const;

/** The diagnosis starts on the Access path; the submission records this page as its entry */
export async function AxAccessDiagnosisSection({ locale }: SectionProps) {
  const t = await getTranslations({ locale, namespace: 'axAccess.diagnosis' });
  return (
    <AxDiagnosisFrame
      intro={
        <>
          <p aria-hidden="true" className={EYEBROW}>
            {t('eyebrow')}
          </p>
          <h2 id="ax-diagnosis-heading" className={`mt-2 ${SECTION_HEADING}`}>
            {t('title')}
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-center font-bold leading-relaxed">
            {t('lead')}
          </p>
        </>
      }
    >
      <AxDiagnosisFlow
        locale={locale}
        privacyPolicyUrl={axPrivacyPolicyUrl()}
        turnstileSiteKey={turnstileSiteKey()}
        allowedEmailDomains={allowedEmailDomains()}
        embedded
        initialPlatform="access"
        entry="ax-access-lp"
      />
    </AxDiagnosisFrame>
  );
}

/** Trademark notice of the page (the site frame has no place for notes) */
export async function AxAccessTrademark({ locale }: SectionProps) {
  const t = await getTranslations({ locale, namespace: 'axAccess' });
  return (
    <div className="bg-white">
      <p className="mx-auto max-w-6xl px-4 py-6 text-xs leading-relaxed text-gray-600 sm:px-6">
        {t('trademark')}
      </p>
    </div>
  );
}
