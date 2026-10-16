'use client';

import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { AlertCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { useRunnerTranslations } from './runner-context';
import { CHECKBOX_CLASS, LABEL_FOCUS } from './styles';

export interface ContactState {
  company: string;
  name: string;
  email: string;
  phone: string;
}

export type ContactKey = keyof ContactState;

export const EMPTY_CONTACT: ContactState = { company: '', name: '', email: '', phone: '' };

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Order in which the first invalid contact field gets the focus */
export const CONTACT_ERROR_ORDER = ['company', 'name', 'email', 'phone', 'consent'] as const;

/** Element id of a contact error key (what focusFirstError expects) */
export const contactFieldId = (key: ContactKey | 'consent'): string =>
  key === 'consent' ? 'consent' : `contact-${key}`;

const INPUT_TYPES: Record<ContactKey, { type: string; autoComplete: string }> = {
  company: { type: 'text', autoComplete: 'organization' },
  name: { type: 'text', autoComplete: 'name' },
  email: { type: 'email', autoComplete: 'email' },
  phone: { type: 'tel', autoComplete: 'tel' },
};

interface ContactTextFieldProps {
  field: ContactKey;
  value: string;
  error?: string;
  required: boolean;
  onChange: (value: string) => void;
}

/** A labelled contact input with its required/optional badge and its error */
export function ContactTextField({
  field,
  value,
  error,
  required,
  onChange,
}: ContactTextFieldProps) {
  const t = useRunnerTranslations();
  const { type, autoComplete } = INPUT_TYPES[field];
  return (
    <div className={cn('space-y-1.5', field === 'email' && 'sm:col-span-2')}>
      <Label htmlFor={`contact-${field}`} className="text-sm font-bold">
        {t(`contact.${field}`)}
        {required ? (
          <span className="ml-2 rounded bg-ax-coral-dark px-1.5 py-0.5 text-xs font-bold text-white">
            {t('required')}
          </span>
        ) : (
          <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-xs font-bold text-gray-600">
            {t('optional')}
          </span>
        )}
      </Label>
      <Input
        id={`contact-${field}`}
        type={type}
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={Boolean(error)}
        aria-required={required}
        aria-describedby={error ? `contact-${field}-error` : undefined}
        className={cn(
          'h-12 border-gray-500 text-base focus-visible:ring-ax-teal-dark',
          error && 'border-2 border-red-600'
        )}
      />
      {error && (
        <p
          id={`contact-${field}-error`}
          className="flex items-center gap-1.5 text-sm font-bold text-red-700"
        >
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}
    </div>
  );
}

/** Hidden from people, filled by bots */
export function HoneypotField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
      <label htmlFor="contact-website">Website</label>
      <input
        id="contact-website"
        tabIndex={-1}
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

interface ConsentFieldProps {
  checked: boolean;
  /** The diagnosis' own notice (builder definitions); default: contact.consentNotice */
  notice?: string;
  error?: string;
  privacyPolicyUrl?: string;
  /** Another diagnosis after the first: the contact details are kept, the consent is not */
  continuing: boolean;
  onChange: (value: boolean) => void;
}

/** The privacy notice and the consent checkbox */
export function ConsentField({
  checked,
  notice,
  error,
  privacyPolicyUrl,
  continuing,
  onChange,
}: ConsentFieldProps) {
  const t = useRunnerTranslations('contact');
  return (
    <div className="space-y-2">
      {continuing && (
        <p className="rounded-xl bg-ax-mist p-3 text-sm leading-relaxed">{t('consentAgain')}</p>
      )}
      <p className="whitespace-pre-line text-sm leading-relaxed text-gray-700">
        {notice ?? t('consentNotice')}
        {privacyPolicyUrl && (
          <>
            {' '}
            <a
              href={privacyPolicyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-bold text-ax-teal-dark underline"
            >
              {t('privacyPolicy')}
            </a>
          </>
        )}
      </p>
      <Label
        htmlFor="consent"
        className={cn('flex cursor-pointer items-center gap-3', LABEL_FOCUS)}
      >
        <Checkbox
          id="consent"
          checked={checked}
          onCheckedChange={(state) => onChange(state === true)}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? 'consent-error' : undefined}
          className={CHECKBOX_CLASS}
        />
        <span className="text-sm font-bold">{t('consent')}</span>
      </Label>
      {error && (
        <p id="consent-error" className="flex items-center gap-1.5 text-sm font-bold text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}
    </div>
  );
}

interface ContactFieldsProps {
  contact: ContactState;
  errors: Record<string, string>;
  consent: boolean;
  honeypot: string;
  privacyPolicyUrl?: string;
  /** The diagnosis' own consent text, shown as plain text instead of contact.consentNotice */
  consentNotice?: string;
  onContact: (field: ContactKey, value: string) => void;
  onConsent: (value: boolean) => void;
  onHoneypot: (value: string) => void;
  /** Diagnosis-specific options between the details and the consent (e.g. a consultation) */
  extra?: ReactNode;
  /** Bot check shown under the consent (Cloudflare Turnstile), when configured */
  verification?: ReactNode;
  /** Another diagnosis after the first: the contact details are kept, the consent is not */
  continuing?: boolean;
}

/** The contact step: company, name and email (all required), consent and the bot check */
export function ContactFields({
  contact,
  errors,
  consent,
  honeypot,
  privacyPolicyUrl,
  consentNotice,
  onContact,
  onConsent,
  onHoneypot,
  extra,
  verification,
  continuing = false,
}: ContactFieldsProps) {
  const t = useRunnerTranslations('contact');
  return (
    <div className="space-y-6">
      <p className="text-sm leading-relaxed text-gray-700">
        {t('description')} {t('sendNote')}
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        {(['company', 'name', 'email'] as const).map((field) => (
          <ContactTextField
            key={field}
            field={field}
            value={contact[field]}
            error={errors[field]}
            required
            onChange={(value) => onContact(field, value)}
          />
        ))}
      </div>

      <HoneypotField value={honeypot} onChange={onHoneypot} />

      {extra}

      <ConsentField
        checked={consent}
        notice={consentNotice}
        error={errors.consent}
        privacyPolicyUrl={privacyPolicyUrl}
        continuing={continuing}
        onChange={onConsent}
      />

      {verification}
    </div>
  );
}
