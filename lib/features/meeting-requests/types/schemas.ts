import { z } from 'zod';

/**
 * First meeting preferences sent with a consultation request, and the one sales confirm
 * (Refs #155). Dates and times are Japan time.
 */

export const MEETING_FORMATS = ['onsite', 'online'] as const;
export type MeetingFormat = (typeof MEETING_FORMATS)[number];

/** Same values as the diagnosis question 'role' (labels come from the diagnosis) */
export const MEETING_ATTENDEE_ROLES = [
  'executive',
  'it_manager',
  'it_staff',
  'business_manager',
  'business_staff',
  'other',
] as const;
export type MeetingAttendeeRole = (typeof MEETING_ATTENDEE_ROLES)[number];

export const MAX_MEETING_CANDIDATES = 3;

/** Start times offered: 09:00 to 18:00 every 30 minutes */
export const MEETING_TIMES: readonly string[] = Array.from({ length: 19 }, (_, index) => {
  const minutes = 9 * 60 + index * 30;
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${minutes % 60 === 0 ? '00' : '30'}`;
});

/** Preferred dates from the next day up to this many days ahead */
export const MEETING_DAYS_AHEAD = 60;

/** What the respondent wants to talk about (Refs #244); stable ids, labels come from locales */
export const MEETING_TOPICS = [
  'result_detail',
  'migration_approach',
  'cost',
  'schedule',
  'target_platform',
  'current_assessment',
  'internal_resources',
  'other',
] as const;
export type MeetingTopic = (typeof MEETING_TOPICS)[number];

/** Free text about the consultation, in UTF-16 code units (what a textarea maxLength counts) */
export const MAX_TOPIC_NOTE_LENGTH = 300;

/**
 * Like PLAIN_TEXT (lib/utils/plain-text.ts: no control or format characters), but line
 * breaks and tabs are allowed in the note. Lone surrogates are refused too: JSON escapes them
 * (and control characters) to six bytes each, which would not fit the consultation body limit.
 */
const NOTE_TEXT = /^(?:[\n\t]|[^\p{Cc}\p{Cf}\p{Cs}])*$/u;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, 'Invalid date');

export const meetingCandidateSchema = z.object({
  date: isoDate,
  time: z.string().refine((value) => MEETING_TIMES.includes(value), 'Invalid time'),
});
export type MeetingCandidate = z.infer<typeof meetingCandidateSchema>;

export const meetingPreferencesSchema = z.object({
  candidates: z
    .array(meetingCandidateSchema)
    .min(1)
    .max(MAX_MEETING_CANDIDATES)
    .refine(
      (candidates) =>
        new Set(candidates.map((c) => `${c.date} ${c.time}`)).size === candidates.length,
      'Duplicate candidate'
    ),
  attendeeRoles: z
    .array(z.enum(MEETING_ATTENDEE_ROLES))
    .max(MEETING_ATTENDEE_ROLES.length)
    .default([])
    .transform((roles) => [...new Set(roles)]),
  meetingFormat: z.enum(MEETING_FORMATS).nullable().default(null),
  /** Stored in MEETING_TOPICS order, whatever order they were ticked in */
  topics: z
    .array(z.enum(MEETING_TOPICS))
    .max(MEETING_TOPICS.length)
    .default([])
    .refine((topics) => new Set(topics).size === topics.length, 'Duplicate topic')
    .transform((topics) => MEETING_TOPICS.filter((topic) => topics.includes(topic))),
  /**
   * Line breaks as \n, trimmed, no other control or format characters (see NOTE_TEXT); empty
   * becomes null
   */
  topicNote: z
    .string()
    .transform((note) => note.replace(/\r\n?/g, '\n'))
    .pipe(z.string().trim().max(MAX_TOPIC_NOTE_LENGTH).regex(NOTE_TEXT, 'Invalid character'))
    .nullable()
    .default(null)
    .transform((note) => note || null),
});
export type MeetingPreferences = z.infer<typeof meetingPreferencesSchema>;

export const leadScopeSchema = z.object({
  organizationId: z.string().uuid(),
  leadId: z.string().uuid(),
});

export const confirmMeetingSchema = leadScopeSchema.extend({
  /** Index of the chosen candidate */
  candidateIndex: z
    .number()
    .int()
    .min(0)
    .max(MAX_MEETING_CANDIDATES - 1),
  /**
   * The chosen candidate as sales saw it: the respondent may have replaced the preferences since
   * (#274), and then nothing is confirmed
   */
  candidate: meetingCandidateSchema,
  /** Send the confirmation email to the respondent */
  sendEmail: z.boolean().default(true),
});
export type ConfirmMeetingInput = z.infer<typeof confirmMeetingSchema>;
