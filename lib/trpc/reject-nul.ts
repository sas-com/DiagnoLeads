/**
 * NUL (U+0000) in tRPC input (#621). PostgreSQL's text and jsonb cannot store it, so a write fails
 * in the database and comes back as INTERNAL_SERVER_ERROR, which alerts whoever is on call. The
 * input is refused before any procedure runs instead. Other control characters (line breaks,
 * tabs) are left alone: saved values may contain them and must stay editable.
 */

export { containsNul } from '@/lib/utils/contains-nul';

export const NUL_INPUT_MESSAGE = '入力に使えない文字（NUL）が含まれています';
