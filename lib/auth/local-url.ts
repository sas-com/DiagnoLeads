/** http://localhost or http://127.0.0.1 (any port): a build run on the machine itself (E2E) */
export function isLocalHttpUrl(url: string): boolean {
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(url);
}
