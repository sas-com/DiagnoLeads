/**
 * Result page of builder diagnoses (#116): blocks as plain text, only the blocks for the result
 * type, the built-in consultation request
 */
import { DiagnosisResult } from '@/components/features/public-diagnosis/diagnosis-result';
import { toPublicDefinition } from '@/lib/features/diagnosis-builder/evaluate';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ja from '../../../../locales/ja/common.json';
import { cloudReadiness } from '../../../fixtures/diagnosis-builder';

afterEach(() => {
  vi.unstubAllGlobals();
});

const SUBMISSION_ID = '99999999-9999-4999-8999-999999999999';

function renderResult(resultTypeId: string | null, consultationRequested = false) {
  const def = cloudReadiness();
  def.resultBlocks.push({ type: 'text', text: '<b>太字ではない</b>\n2行目' });
  return render(
    <NextIntlClientProvider locale="ja" messages={ja} timeZone="Asia/Tokyo">
      <DiagnosisResult
        slug="cloud-check"
        definition={toPublicDefinition(def)}
        company="架空商事"
        submissionId={SUBMISSION_ID}
        result={{
          axes: { infra: { pct: 43 }, people: { pct: 0 } },
          overall: 29,
          tiers: { overall: 'low', infra_tiers: 'weak' },
          resultTypeId,
        }}
        consultationRequested={consultationRequested}
      />
    </NextIntlClientProvider>
  );
}

describe('DiagnosisResult', () => {
  it('shows the result type, scores and the blocks for it, all text as text', () => {
    const { container } = renderResult('planner');
    expect(screen.getByRole('heading', { name: '計画型' })).toBeInTheDocument();
    expect(screen.getByText('架空商事 様の診断結果')).toBeInTheDocument();
    expect(screen.getByText('低い段階です。')).toBeInTheDocument();
    expect(screen.getByText('計画型の方へ')).toBeInTheDocument();
    expect(screen.getByText('29%')).toBeInTheDocument();
    // Markup in a text block stays text
    expect(container.querySelector('b')).toBeNull();
    expect(screen.getByText(/<b>太字ではない<\/b>/)).toHaveClass('whitespace-pre-line');
    expect(screen.getByRole('link', { name: /相談する/ })).toHaveAttribute(
      'href',
      'https://example.com/contact'
    );
  });

  it('leaves out blocks meant for another result type', () => {
    renderResult('starter');
    expect(screen.queryByText('計画型の方へ')).toBeNull();
  });

  it('requests a consultation for the submission', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderResult('planner');
    await user.click(screen.getByRole('button', { name: '個別相談を申し込む' }));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/diagnoses/cloud-check/consultation',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ submissionId: SUBMISSION_ID }) })
    );
    expect(await screen.findByText(/お申し込みを受け付けました/)).toBeInTheDocument();
  });

  it('a consultation requested with the answers is shown as received', () => {
    renderResult('planner', true);
    expect(screen.queryByRole('button', { name: '個別相談を申し込む' })).toBeNull();
    expect(screen.getByText(/お申し込みを受け付けました/)).toBeInTheDocument();
  });
});
