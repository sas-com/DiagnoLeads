import type { DiagnosisRunnerConfig } from '@/components/features/diagnosis-runner/runner-context';

/** Builder diagnoses' texts live under publicDiagnosis; their page-level ids start with "dx-" */
export const PUBLIC_DIAGNOSIS_RUNNER_CONFIG: DiagnosisRunnerConfig = {
  namespace: 'publicDiagnosis',
  idPrefix: 'dx',
};
