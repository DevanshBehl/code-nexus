import { describe, expect, it } from 'vitest';
import {
  DUMMY_PASSWORD_HASH,
  generateTempPassword,
  hashPassword,
  passwordPolicySchema,
  verifyPassword,
} from './password.js';

describe('password hashing', () => {
  it('hash is not the plaintext and verifies correctly', async () => {
    const hash = await hashPassword('Str0ngPassw0rd!', 8);
    expect(hash).not.toBe('Str0ngPassw0rd!');
    expect(await verifyPassword('Str0ngPassw0rd!', hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
  });

  it('exposes a valid dummy hash for constant-time login', async () => {
    expect(DUMMY_PASSWORD_HASH).toMatch(/^\$2[aby]\$/);
    expect(await verifyPassword('anything', DUMMY_PASSWORD_HASH)).toBe(false);
  });
});

describe('temp password generation', () => {
  it('is long, random, and policy-compliant', () => {
    const a = generateTempPassword();
    const b = generateTempPassword();
    expect(a.length).toBeGreaterThanOrEqual(16);
    expect(a).not.toBe(b);
    expect(passwordPolicySchema(12).safeParse(a).success).toBe(true);
  });
});

describe('password policy', () => {
  const schema = passwordPolicySchema(12, 'TempPass123!');

  it('rejects too-short passwords', () => {
    expect(schema.safeParse('Ab1abcdef').success).toBe(false);
  });
  it('requires lower/upper/digit', () => {
    expect(schema.safeParse('alllowercase1').success).toBe(false);
    expect(schema.safeParse('ALLUPPERCASE1').success).toBe(false);
    expect(schema.safeParse('NoDigitsHereX').success).toBe(false);
  });
  it('rejects the forbidden temp password', () => {
    expect(schema.safeParse('TempPass123!').success).toBe(false);
  });
  it('accepts a strong new password', () => {
    expect(schema.safeParse('NewStr0ngPass!').success).toBe(true);
  });
});
