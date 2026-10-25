/**
 * Inputs of the tag assignment (tags.setLeadTags and tags.bulkSetLeadTags, #669). No screen
 * calls them yet; the bulk tagging of the lead list is planned in Epic #430.
 */
import { LEAD_LIST_PAGE_MAX } from '@/lib/features/leads/types/schemas';
import { z } from 'zod';

/**
 * Most tags one call gives a lead. Tags are labels picked by hand, and the lead list shows three
 * of a lead's tags and a count of the rest (TagBadgeList); twenty is well past that. It also
 * bounds the one insert of bulkSetLeadTags (leads × tags rows) to LEAD_LIST_PAGE_MAX × 20 = 2,000
 * rows.
 */
export const LEAD_TAGS_MAX = 20;

/**
 * The tags a lead is given, replacing the ones it has (none clears them). A repeated id counts
 * toward the limit and is stored once.
 */
export const leadTagIdsSchema = z
  .array(z.string().uuid())
  .max(LEAD_TAGS_MAX, `一度に付けられるタグは${LEAD_TAGS_MAX}個までです`);

/**
 * The leads of tags.bulkSetLeadTags: as many as one page of the lead list, like the bulk actions
 * of leads (#604). A repeated id counts toward the limit and is tagged once.
 */
export const bulkTagLeadIdsSchema = z
  .array(z.string().uuid())
  .max(LEAD_LIST_PAGE_MAX, `一度に選べるリードは${LEAD_LIST_PAGE_MAX}件までです`);
