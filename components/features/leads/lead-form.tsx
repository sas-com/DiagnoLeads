'use client';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { Lead } from '@/lib/db/schema';
import {
  CONVERSION_POINTS,
  DEAL_PHASES,
  INFLOW_SOURCES,
  LEAD_STATUSES,
  LOST_REASONS,
  type LeadPipelineFields,
  type LeadStatus,
  SQL_DECISIONS,
  TARGET_SYSTEMS,
  createLeadSchema,
  makesLostOnHold,
} from '@/lib/features/leads/types';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';

// Form schema without organizationId (will be added by parent component)
const formSchema = createLeadSchema.omit({ organizationId: true });
type FormValues = z.infer<typeof formSchema>;

/** Sentinel for "not set" because Radix Select does not accept an empty value */
const NONE = '__none__';

type PipelineSelectField = keyof Pick<
  LeadPipelineFields,
  'inflowSource' | 'conversionPoint' | 'dealPhase' | 'targetSystem' | 'lostReason'
>;

const PIPELINE_SELECTS: { name: PipelineSelectField; options: readonly string[] }[] = [
  { name: 'inflowSource', options: INFLOW_SOURCES },
  { name: 'conversionPoint', options: CONVERSION_POINTS },
  { name: 'dealPhase', options: DEAL_PHASES },
  { name: 'targetSystem', options: TARGET_SYSTEMS },
  { name: 'lostReason', options: LOST_REASONS },
];

interface LeadFormProps {
  lead?: Lead;
  /** All values for a new lead; only the changed ones when editing */
  onSubmit: (data: Partial<FormValues>) => void | Promise<void>;
  isLoading?: boolean;
}

/**
 * Lead form component
 * Used for creating and editing leads
 */
export function LeadForm({ lead, onSubmit, isLoading }: LeadFormProps) {
  const t = useTranslations('leads');
  const tStatus = useTranslations('status');
  const tPipeline = useTranslations('pipeline');
  const tCommon = useTranslations('common');

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      email: lead?.email ?? '',
      name: lead?.name ?? '',
      company: lead?.company ?? '',
      phone: lead?.phone ?? '',
      status: (lead?.status as LeadStatus) ?? 'new',
      score: lead?.score ?? undefined,
      source: (lead?.source as 'website' | 'embed' | 'api') ?? undefined,
      responses: lead?.responses ?? {},
      inflowSource: (lead?.inflowSource as FormValues['inflowSource']) ?? null,
      conversionPoint: (lead?.conversionPoint as FormValues['conversionPoint']) ?? null,
      dealPhase: (lead?.dealPhase as FormValues['dealPhase']) ?? null,
      targetSystem: (lead?.targetSystem as FormValues['targetSystem']) ?? null,
      lostReason: (lead?.lostReason as FormValues['lostReason']) ?? null,
      referrerName: lead?.referrerName ?? null,
      agencyName: lead?.agencyName ?? null,
      acquisitionCost: lead?.acquisitionCost ?? null,
      mqlQualified: Boolean(lead?.mqlQualifiedAt),
      sqlDecision: (lead?.sqlDecision as FormValues['sqlDecision']) ?? null,
    },
  });

  // Editing sends only the changed fields: values written while the form was open (a
  // consultation request, an MQL from another diagnosis, follow-up answers, a new score) are not
  // set back to what the form was opened with
  const submit = form.handleSubmit((values) => {
    const dirty = form.formState.dirtyFields as Partial<Record<keyof FormValues, unknown>>;
    const changes = lead
      ? (Object.fromEntries(
          Object.entries(values).filter(([key]) => Boolean(dirty[key as keyof FormValues]))
        ) as Partial<FormValues>)
      : values;
    // 保留 is not a loss (#445). The form shows the reason, so ask to choose again rather than
    // let the server drop 保留 (it refuses 保留 sent with a lost lead too)
    if (makesLostOnHold(lead, { status: values.status, lostReason: values.lostReason })) {
      form.setError('lostReason', { message: t('lostOnHold') }, { shouldFocus: true });
      return;
    }
    return onSubmit(changes);
  });

  return (
    <Form {...form}>
      <form onSubmit={submit} className="space-y-6">
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('email')} *</FormLabel>
              <FormControl>
                <Input type="email" placeholder={t('placeholders.email')} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('name')}</FormLabel>
              <FormControl>
                <Input placeholder={t('placeholders.name')} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="company"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('company')}</FormLabel>
              <FormControl>
                <Input placeholder={t('placeholders.company')} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="phone"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('phone')}</FormLabel>
              <FormControl>
                <Input placeholder={t('placeholders.phone')} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="status"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('status')}</FormLabel>
              <Select
                onValueChange={(value) => {
                  field.onChange(value);
                  form.clearErrors('lostReason');
                }}
                value={field.value}
              >
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder={t('status')} />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {LEAD_STATUSES.map((status) => (
                    <SelectItem key={status} value={status}>
                      {tStatus(status)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="score"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('score')} (0-100)</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  {...field}
                  value={field.value ?? ''}
                  onChange={(e) =>
                    field.onChange(e.target.value ? Number.parseInt(e.target.value) : undefined)
                  }
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="space-y-4 rounded-md border p-4">
          <p className="text-sm font-medium">{t('pipeline')}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            {PIPELINE_SELECTS.map(({ name, options }) => (
              <FormField
                key={name}
                control={form.control}
                name={name}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t(name)}</FormLabel>
                    <Select
                      onValueChange={(value) => field.onChange(value === NONE ? null : value)}
                      value={field.value ?? NONE}
                    >
                      <FormControl>
                        <SelectTrigger ref={field.ref}>
                          <SelectValue placeholder={t('notSet')} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value={NONE}>{t('notSet')}</SelectItem>
                        {options.map((option) => (
                          <SelectItem key={option} value={option}>
                            {tPipeline(`${name}.${option}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ))}
            <FormField
              control={form.control}
              name="referrerName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('referrerName')}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      value={field.value ?? ''}
                      onChange={(e) => field.onChange(e.target.value || null)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="agencyName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('agencyName')}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      value={field.value ?? ''}
                      onChange={(e) => field.onChange(e.target.value || null)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="acquisitionCost"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('acquisitionCost')}</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      step={1}
                      {...field}
                      value={field.value ?? ''}
                      onChange={(e) =>
                        field.onChange(e.target.value === '' ? null : Number(e.target.value))
                      }
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <div className="grid gap-4 border-t pt-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="mqlQualified"
              render={({ field }) => (
                <FormItem className="flex items-center gap-2 space-y-0">
                  <FormControl>
                    <Checkbox
                      checked={field.value ?? false}
                      onCheckedChange={(state) => field.onChange(state === true)}
                    />
                  </FormControl>
                  <FormLabel className="font-normal">{t('mqlQualified')}</FormLabel>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="sqlDecision"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('sqlDecision')}</FormLabel>
                  <Select
                    onValueChange={(value) => field.onChange(value === NONE ? null : value)}
                    value={field.value ?? NONE}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder={t('sqlUndecided')} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={NONE}>{t('sqlUndecided')}</SelectItem>
                      {SQL_DECISIONS.map((decision) => (
                        <SelectItem key={decision} value={decision}>
                          {tPipeline(`sqlDecision.${decision}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </div>

        <div className="flex gap-4 justify-end">
          <Button type="submit" disabled={isLoading}>
            {isLoading ? tCommon('loading') : lead ? tCommon('update') : tCommon('create')}
          </Button>
        </div>
      </form>
    </Form>
  );
}
