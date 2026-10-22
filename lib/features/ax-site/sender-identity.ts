import en from '@/locales/en/common.json';
import ja from '@/locales/ja/common.json';
/**
 * Who sends the mail a respondent of the AX diagnosis receives (#154).
 *
 * One place for the sender shown in that mail: the company, its address and the DX Services
 * Division as printed in the AX site footer, the division's contact details, and the privacy
 * policy. Replies go to the same contact address.
 */
import { AX_CONTACT, axPrivacyPolicyUrl } from './contact';

export type AxMailLocale = 'ja' | 'en';

export interface AxSenderIdentity {
  locale: AxMailLocale;
  /** Company name, also the brand in the header of the mail */
  operatorName: string;
  department: string;
  address: string;
  email: string;
  phone: string;
  /** null while NEXT_PUBLIC_AX_PRIVACY_POLICY_URL is not set */
  privacyPolicyUrl: string | null;
  /** Reply-To of every respondent mail: the division's contact address */
  replyTo: string;
}

const FOOTERS = { ja: ja.axSite.footer, en: en.axSite.footer } as const;

export function axSenderIdentity(locale: AxMailLocale): AxSenderIdentity {
  const footer = FOOTERS[locale];
  return {
    locale,
    operatorName: footer.companyName,
    department: footer.department,
    address: footer.address,
    email: AX_CONTACT.email,
    phone: AX_CONTACT.phone,
    privacyPolicyUrl: axPrivacyPolicyUrl() ?? null,
    replyTo: AX_CONTACT.email,
  };
}
