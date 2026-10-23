import { supportedLocaleOr } from '@/lib/i18n/config';
import { redirect } from 'next/navigation';

/**
 * /organizations was a placeholder with sample values. The organization settings live in
 * /settings/organization (members in /settings/members), so this address goes there (#164).
 */
export default async function OrganizationsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect(`/${supportedLocaleOr(locale)}/settings/organization`);
}
