'use client';

import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { ContactTextField } from './contact-fields';
import { useRunnerTranslations } from './runner-context';
import { CHECKBOX_CLASS, LABEL_FOCUS } from './styles';

interface ConsultationRequestProps {
  checked: boolean;
  phone: string;
  phoneError?: string;
  onChange: (value: boolean) => void;
  onPhone: (value: string) => void;
}

/** "I would like a consultation", with an optional phone number once it is ticked */
export function ConsultationRequest({
  checked,
  phone,
  phoneError,
  onChange,
  onPhone,
}: ConsultationRequestProps) {
  const t = useRunnerTranslations('contact');
  return (
    <div className="space-y-4 rounded-2xl border border-gray-200 p-4">
      <Label
        htmlFor="consultation"
        className={cn('flex cursor-pointer items-start gap-3', LABEL_FOCUS)}
      >
        <Checkbox
          id="consultation"
          checked={checked}
          onCheckedChange={(state) => onChange(state === true)}
          className={cn('mt-0.5', CHECKBOX_CLASS)}
        />
        <span>
          <span className="block text-sm font-bold">{t('consultation')}</span>
          <span className="block text-sm text-gray-600">{t('consultationHint')}</span>
        </span>
      </Label>
      {checked && (
        <div className="grid gap-4 sm:grid-cols-2">
          <ContactTextField
            field="phone"
            value={phone}
            error={phoneError}
            required={false}
            onChange={onPhone}
          />
        </div>
      )}
    </div>
  );
}
