'use client';

import { useTranslations } from 'next-intl';
import { type ReactNode, createContext, useContext } from 'react';

/**
 * Where the respondent parts find their texts and how they name their element ids.
 *
 * Texts are read from `namespace` with these keys: optional, required, quoted, listJoiner,
 * multipleHint, multipleHintExclusive, progress, back, next, submit, submitting,
 * restore.{prompt,continue,startOver}, contact.{company,name,email,phone,description,sendNote,
 * consentAgain,consentNotice,privacyPolicy,consent},
 * verification.{label,help,unavailable,failed,retry,alternative}; and, for diagnoses with those
 * question types, scaleHint, numberHint and textCount.
 */
export interface DiagnosisRunnerConfig {
  /** next-intl namespace holding the keys above (e.g. 'axDiagnosis') */
  namespace: string;
  /**
   * Prefix of the ids of the page-level parts only: the step heading, the Turnstile check and
   * its help text (e.g. 'ax' → 'ax-step-heading'). Question, option, contact and consent ids are
   * not prefixed (`q-{id}`, `contact-email`, `consent`, ...), so one runner per page.
   */
  idPrefix: string;
}

const RunnerConfigContext = createContext<DiagnosisRunnerConfig | null>(null);

export function DiagnosisRunnerProvider({
  config,
  children,
}: {
  config: DiagnosisRunnerConfig;
  children: ReactNode;
}) {
  return <RunnerConfigContext.Provider value={config}>{children}</RunnerConfigContext.Provider>;
}

export function useRunnerConfig(): DiagnosisRunnerConfig {
  const config = useContext(RunnerConfigContext);
  if (!config) throw new Error('Diagnosis runner parts need a DiagnosisRunnerProvider');
  return config;
}

/** Translator for the runner's namespace (optionally a sub-namespace of it) */
export function useRunnerTranslations(sub?: string) {
  const { namespace } = useRunnerConfig();
  return useTranslations(sub ? `${namespace}.${sub}` : namespace);
}
