import { randomInt } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';

const DEFAULT_COST = 12;

/**
 * A valid bcrypt hash of a random value, computed once. Used to run a real
 * bcrypt comparison when a login references a non-existent user, so response
 * timing does not reveal whether the account exists (see auth.service).
 */
export const DUMMY_PASSWORD_HASH: string = bcrypt.hashSync(
  `dummy-${randomInt(1e9)}-${randomInt(1e9)}`,
  DEFAULT_COST,
);

export async function hashPassword(plain: string, cost: number = DEFAULT_COST): Promise<string> {
  return bcrypt.hash(plain, cost);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

// Unambiguous, complexity-satisfying charset for generated temp passwords.
const LOWER = 'abcdefghijkmnpqrstuvwxyz';
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGIT = '23456789';
const SYMBOL = '!@#$%^&*-_';
const ALL = LOWER + UPPER + DIGIT + SYMBOL;

/**
 * Cryptographically-random temp password (default 20 chars), guaranteed to
 * contain lower/upper/digit/symbol so it satisfies the password policy.
 */
export function generateTempPassword(length = 20): string {
  const required = [
    LOWER[randomInt(LOWER.length)],
    UPPER[randomInt(UPPER.length)],
    DIGIT[randomInt(DIGIT.length)],
    SYMBOL[randomInt(SYMBOL.length)],
  ];
  const rest = Array.from({ length: Math.max(length, 16) - required.length }, () =>
    ALL.charAt(randomInt(ALL.length)),
  );
  // Fisher–Yates shuffle so the required chars aren't in fixed positions.
  const chars = [...required, ...rest];
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join('');
}

/**
 * Build the password-policy zod schema. Enforces min length + basic complexity
 * (lower + upper + digit) and optionally forbids a specific value (the temp
 * password being replaced).
 */
export function passwordPolicySchema(minLength = 12, forbidden?: string): z.ZodType<string> {
  return z
    .string()
    .min(minLength, `Password must be at least ${minLength} characters`)
    .refine((v) => /[a-z]/.test(v), 'Password must contain a lowercase letter')
    .refine((v) => /[A-Z]/.test(v), 'Password must contain an uppercase letter')
    .refine((v) => /[0-9]/.test(v), 'Password must contain a digit')
    .refine(
      (v) => !forbidden || v !== forbidden,
      'Choose a password different from the temporary one',
    );
}
