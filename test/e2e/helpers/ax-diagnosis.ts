import { type Locator, type Page, type Request, type Route, expect } from '@playwright/test';

/**
 * Helpers for the AX migration diagnosis (v2) E2E tests.
 * Submissions need a receiving organization; without it the API answers 503.
 */
export const canSubmit = Boolean(
  process.env.AX_DIAGNOSIS_ORGANIZATION_ID || process.env.DEFAULT_ORGANIZATION_ID
);

const group = (scope: Page | Locator, name: RegExp) => scope.getByRole('group', { name });
const next = (page: Page) => page.getByRole('button', { name: /次へ/ }).click();

/** The company size step (#150) is optional, so go on without answering it */
async function skipCompanySize(page: Page) {
  await expect(page.getByRole('heading', { name: /会社の規模（任意）/ })).toBeVisible();
  await next(page);
}

async function answerBusiness(page: Page, challenge: RegExp, role = '情報システム部門の責任者') {
  await group(page, /いま感じている課題/).getByLabel(challenge).check();
  await group(page, /切り替えを目指す時期/).getByLabel('1〜2年以内').check();
  await group(page, /業種/).getByLabel('製造業').check();
  await group(page, /あなたの立場/).getByLabel(role).check();
  await next(page);
  await skipCompanySize(page);
}

/** AS/400 maintained by one or two people, with some source missing */
export async function answerAs400(page: Page) {
  await page.getByTestId('platform-as400').click();
  await group(page, /直せる（改修できる）人/).getByLabel(/当面は続けられる/).check();
  await group(page, /保守期限/).getByLabel('1〜3年以内').check();
  await group(page, /データのやり取り/).getByLabel('いくつかある（3〜9）').check();
  await next(page);
  await group(page, /プログラムはおよそ何本/).getByLabel('500〜1,999本').check();
  await group(page, /どんな言語・方法/).getByLabel(/RPG IV/).check();
  await group(page, /仕様書は手元/).getByLabel(/ソースが一部見当たらない/).check();
  await next(page);
  await answerBusiness(page, /扱える人が減って/);
}

/** ACOS-4 past its support end, with nobody left to maintain it */
export async function answerAcos(page: Page) {
  await page.getByTestId('platform-acos').click();
  await group(page, /ACOSの種類/).getByLabel(/ACOS-4/).check();
  await group(page, /直せる（改修できる）人/).getByLabel(/直せる人がいない/).check();
  await group(page, /保守期限/).getByLabel(/すでに過ぎている/).check();
  await next(page);
  await group(page, /プログラムはおよそ何本/).getByLabel('3,000〜9,999本').check();
  await group(page, /COBOL以外/).getByLabel('ほぼCOBOLだけ').check();
  await group(page, /仕様書は手元/).getByLabel(/仕様書もおおむね最新/).check();
  await next(page);
  await answerBusiness(page, /保守・延命の費用/);
}

/** Department Access tools whose author has left */
export async function answerAccess(page: Page) {
  await page.getByTestId('platform-access').click();
  await group(page, /直せる（変更できる）人/).getByLabel(/直せる人がいない/).check();
  await group(page, /お使いのAccess/).getByLabel('2016・2019').check();
  await next(page);
  await group(page, /ツール（業務）はいくつ/).getByLabel('2〜5').check();
  await group(page, /画面と帳票/).getByLabel('20〜50').check();
  await group(page, /このツールで当てはまるもの/).getByLabel(/ボタン一つで/).check();
  await next(page);
  await group(page, /いま感じている課題/).getByLabel(/同時に使えない/).check();
  await group(page, /切り替えを目指す時期/).getByLabel('1年以内').check();
  await group(page, /業種/).getByLabel('製造業').check();
  await group(page, /あなたの立場/).getByLabel(/業務部門の責任者/).check();
  await next(page);
  await skipCompanySize(page);
}

export async function fillContact(page: Page, email: string) {
  await expect(page.getByRole('heading', { name: /最後に、ご連絡先/ })).toBeVisible();
  await page.getByLabel(/会社名/).fill('E2E製作所');
  await page.getByLabel(/お名前/).fill('E2E 太郎');
  await page.getByLabel(/会社のメールアドレス/).fill(email);
  await page.getByLabel('個人情報の取り扱いに同意する').check();
}

/** With the Turnstile check on (TURNSTILE_* set), wait until it has given a token */
export async function waitForBotCheck(page: Page) {
  const widget = page.getByTestId('ax-turnstile');
  if ((await widget.count()) === 0) return;
  await expect(widget.locator('input[name="cf-turnstile-response"]')).not.toHaveValue('', {
    timeout: 30_000,
  });
}

type Json = Record<string, unknown>;

interface Submission {
  /** The request body the page sent */
  sent: Json;
  /** The JSON the API answered */
  body: Json;
}

/** The answer as copied on its way to the page, or why it could not be */
type Answer = { sent: Json; status: number; text: string } | Error;

const isSubmissionUrl = (url: URL) => url.pathname === '/api/diagnostics/ax-migration';
const isSubmission = (request: Request) =>
  request.method() === 'POST' && isSubmissionUrl(new URL(request.url()));

/** The API answers JSON, so a 200 with anything else is a failure of its own */
function parseAnswer(text: string): Json {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`The API answered 200 with a body that is not JSON: ${text.slice(0, 200)}`);
  }
}

/**
 * Submit and return the request body sent and the JSON the API answered.
 *
 * The answer is copied in Node on its way to the page, so its body is never read back from the
 * browser (#572). Read from the browser after the click (`response.json()`), the body was once
 * gone in CI ("No resource with given identifier found"). What dropped it there is not known.
 */
export async function submitWithRequest(page: Page): Promise<Submission> {
  await waitForBotCheck(page);
  let settle: (answer: Answer) => void = () => {};
  const answered = new Promise<Answer>((resolve) => {
    settle = resolve;
  });
  const handler = async (route: Route) => {
    if (!isSubmission(route.request())) {
      await route.fallback();
      return;
    }
    try {
      const sent = route.request().postDataJSON();
      const response = await route.fetch();
      const text = await response.text();
      // The page gets the same answer, as if the request had gone straight through
      await route.fulfill({ response });
      settle({ sent, status: response.status(), text });
    } catch (error) {
      settle(error instanceof Error ? error : new Error(String(error)));
      await route.abort().catch(() => {});
    }
  };
  // Made here, so its stack points at the test that submitted
  const closed = new Error('The page closed before the API answered the submission');
  const onClose = () => settle(closed);
  await page.route(isSubmissionUrl, handler);
  page.once('close', onClose);
  try {
    // Waiting for the request names the wait in the report when the click sends nothing
    await Promise.all([
      page.waitForRequest(isSubmission),
      page.getByRole('button', { name: /診断結果を見る/ }).click(),
    ]);
    const answer = await answered;
    if (answer instanceof Error) throw answer;
    expect(answer.status, answer.text).toBe(200);
    return { sent: answer.sent, body: parseAnswer(answer.text) };
  } finally {
    page.off('close', onClose);
    if (!page.isClosed()) await page.unroute(isSubmissionUrl, handler);
  }
}

/** Submit and return the JSON the API answered */
export async function submit(page: Page) {
  return (await submitWithRequest(page)).body;
}
