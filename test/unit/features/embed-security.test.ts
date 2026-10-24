/**
 * Embed Security Tests
 *
 * The API key that the embed settings screen issues (generateApiKey, hashApiKey). The public
 * embed API and its origin, CSRF and rate limit checks were removed (#505).
 */

import { describe, expect, it } from 'vitest';
import { generateApiKey, hashApiKey } from '@/lib/features/embed/security';

describe('generateApiKey', () => {
  it('should generate API key with correct prefix', () => {
    const key = generateApiKey();
    expect(key.startsWith('dl_embed_')).toBe(true);
  });

  it('should generate 64 character hex after prefix', () => {
    const key = generateApiKey();
    const hexPart = key.replace('dl_embed_', '');
    expect(hexPart.length).toBe(64);
    expect(/^[0-9a-f]+$/.test(hexPart)).toBe(true);
  });

  it('should generate unique keys', () => {
    const keys = new Set<string>();
    for (let i = 0; i < 100; i++) {
      keys.add(generateApiKey());
    }
    expect(keys.size).toBe(100);
  });
});

describe('hashApiKey', () => {
  it('should produce consistent hash for same input', () => {
    const key = 'dl_embed_test123';
    const hash1 = hashApiKey(key);
    const hash2 = hashApiKey(key);
    expect(hash1).toBe(hash2);
  });

  it('should produce different hash for different input', () => {
    const hash1 = hashApiKey('key1');
    const hash2 = hashApiKey('key2');
    expect(hash1).not.toBe(hash2);
  });

  it('should produce 64 character hex hash', () => {
    const hash = hashApiKey('test');
    expect(hash.length).toBe(64);
    expect(/^[0-9a-f]+$/.test(hash)).toBe(true);
  });
});
