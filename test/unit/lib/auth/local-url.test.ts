import { isLocalHttpUrl } from '@/lib/auth/local-url';
import { describe, expect, it } from 'vitest';

describe('isLocalHttpUrl', () => {
  it('matches plain http to the machine itself only', () => {
    for (const url of ['http://localhost:3000', 'http://localhost', 'http://127.0.0.1:3000/']) {
      expect(isLocalHttpUrl(url)).toBe(true);
    }
    for (const url of [
      'https://diagnoleads-v2.vercel.app',
      'https://localhost:3000',
      'http://localhost.example.com',
      'http://example.com/localhost',
    ]) {
      expect(isLocalHttpUrl(url)).toBe(false);
    }
  });
});
