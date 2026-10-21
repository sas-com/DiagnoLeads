/**
 * Pure helpers of the first meeting preferences (Refs #155)
 */
import { MEETING_DAYS_AHEAD, type MeetingCandidate } from './types/schemas';

function shift(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Days a respondent may choose: from tomorrow up to MEETING_DAYS_AHEAD days ahead (Japan) */
export function candidateDateRange(today: string): { min: string; max: string } {
  return { min: shift(today, 1), max: shift(today, MEETING_DAYS_AHEAD) };
}

/** Whether every candidate falls in the range a respondent may choose */
export function candidatesInRange(candidates: MeetingCandidate[], today: string): boolean {
  const { min, max } = candidateDateRange(today);
  return candidates.every((candidate) => candidate.date >= min && candidate.date <= max);
}

/**
 * For each option of the form, the number (1-based) of an earlier option with the same date and
 * time, or null. Options without a date are not compared.
 */
export function duplicateCandidateOf(rows: MeetingCandidate[]): (number | null)[] {
  return rows.map((row, index) => {
    if (!row.date) return null;
    const earlier = rows.findIndex((r) => r.date === row.date && r.time === row.time);
    return earlier < index ? earlier + 1 : null;
  });
}

/** Earliest first */
export function sortCandidates(candidates: MeetingCandidate[]): MeetingCandidate[] {
  return [...candidates].sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
}

const WEEKDAYS_JA = ['日', '月', '火', '水', '木', '金', '土'];

/** "11月5日（水）14:00" */
export function candidateLabelJa(candidate: MeetingCandidate): string {
  const [year, month, day] = candidate.date.split('-').map(Number);
  const weekday = WEEKDAYS_JA[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return `${month}月${day}日（${weekday}）${candidate.time}`;
}
