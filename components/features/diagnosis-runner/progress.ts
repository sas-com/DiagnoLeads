/** "STEP n / total" for a zero-based step, and the bar's width (the last step reads 100%) */
export function stepProgress(step: number, total: number): { current: number; percent: number } {
  const current = Math.min(step + 1, total);
  return { current, percent: Math.round((current / total) * 100) };
}
