// The rule lives in lib/auth so that analytics can apply it too (#448)
export {
  DEALS_READ_EXCLUDED_ROLES,
  canReadDeals,
  canWriteDeals,
} from '@/lib/auth/deal-access';
