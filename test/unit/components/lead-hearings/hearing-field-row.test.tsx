/**
 * Marker of one hearing field (real ja messages) — Refs #163
 *
 * A required field holding the Web diagnosis answer is "未確認" (waiting to be confirmed),
 * only a field with nothing in it is "未入力".
 */
import { HearingFieldRow } from '@/components/features/lead-hearings/hearing-field-row';
import { type HearingFieldDefinition, getHearingField } from '@/lib/features/lead-hearings/catalog';
import type { HearingFieldEntry } from '@/lib/features/lead-hearings/types/schemas';
import messages from '@/locales/ja/common.json';
import { render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';

const field = (key: string) => getHearingField(key) as HearingFieldDefinition;

function renderRow(key: string, entry: HearingFieldEntry, missing: boolean) {
  return render(
    <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
      <HearingFieldRow
        field={field(key)}
        entry={entry}
        required
        missing={missing}
        hint={null}
        readOnly={false}
        onValueChange={vi.fn()}
        onStatusChange={vi.fn()}
        onConfirm={vi.fn()}
      />
    </NextIntlClientProvider>
  );
}

describe('HearingFieldRow marker', () => {
  it('shows 未確認 (not 未入力) for a required field holding the Web diagnosis answer', () => {
    renderRow('targetSystem', { value: 'as400', status: 'not_yet', source: 'prefilled' }, true);
    const marker = screen.getByTestId('hearing-marker-targetSystem');
    expect(marker).toHaveTextContent('未確認');
    expect(marker).toHaveAttribute('title', 'Web診断の回答のまま、まだ確認していません');
    expect(screen.queryByText('未入力')).not.toBeInTheDocument();
  });

  it('shows 未入力 for a required field with nothing in it', () => {
    renderRow('machineModel', { status: 'not_yet', source: null }, true);
    expect(screen.getByTestId('hearing-marker-machineModel')).toHaveTextContent('未入力');
  });

  it('shows 未入力 when a diagnosis answer was cleared', () => {
    renderRow('machineModel', { value: '  ', status: 'not_yet', source: 'prefilled' }, true);
    expect(screen.getByTestId('hearing-marker-machineModel')).toHaveTextContent('未入力');
  });

  it('shows no marker once the field is filled', () => {
    renderRow('machineModel', { value: 'Power 9', status: 'done', source: null }, false);
    expect(screen.queryByTestId('hearing-marker-machineModel')).not.toBeInTheDocument();
  });

  it('names the status choices in words, not a single character', () => {
    renderRow('machineModel', { status: 'not_yet', source: null }, true);
    const select = screen.getByRole('combobox', { name: '機種・バージョンの状態' });
    expect(within(select).getByText('未確認')).toBeInTheDocument();
    for (const label of Object.values(messages.leadHearings.statuses)) {
      expect(label.length).toBeGreaterThan(1);
    }
  });
});
