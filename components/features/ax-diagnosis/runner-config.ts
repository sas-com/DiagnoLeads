import type { DiagnosisRunnerConfig } from '@/components/features/diagnosis-runner/runner-context';

/** The AX diagnosis' texts live under axDiagnosis; its element ids start with "ax-" */
export const AX_RUNNER_CONFIG: DiagnosisRunnerConfig = { namespace: 'axDiagnosis', idPrefix: 'ax' };
