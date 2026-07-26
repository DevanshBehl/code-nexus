import { describe, expect, it } from 'vitest';
import { signRtToken, verifyRtToken } from './rt-token.js';

const SECRET = 'rt-secret-at-least-16-chars-long';
const base = {
  webinarId: 'w1',
  webinarPublicId: '00000000-0000-0000-0000-000000000001',
  userId: 'u1',
  publicId: 'p1',
  role: 'VIEWER' as const,
  displayName: 'Asha',
  studentId: 's1',
};

describe('RT token sign/verify', () => {
  it('round-trips a valid token and preserves claims', () => {
    const { token } = signRtToken(base, SECRET, 60);
    const payload = verifyRtToken(token, SECRET);
    expect(payload?.userId).toBe('u1');
    expect(payload?.role).toBe('VIEWER');
    expect(payload?.webinarId).toBe('w1');
  });

  it('rejects a tampered payload', () => {
    const { token } = signRtToken(base, SECRET, 60);
    const [, sig] = token.split('.');
    const forged = `${Buffer.from(JSON.stringify({ ...base, role: 'HOST', exp: 9e9 })).toString('base64url')}.${sig}`;
    expect(verifyRtToken(forged, SECRET)).toBeNull();
  });

  it('rejects a wrong secret', () => {
    const { token } = signRtToken(base, SECRET, 60);
    expect(verifyRtToken(token, 'a-different-secret-value')).toBeNull();
  });

  it('rejects an expired token', () => {
    const now = Date.now();
    const { token } = signRtToken(base, SECRET, 10, now);
    expect(verifyRtToken(token, SECRET, now + 11_000)).toBeNull();
  });

  it('rejects garbage', () => {
    expect(verifyRtToken('not-a-token', SECRET)).toBeNull();
    expect(verifyRtToken('', SECRET)).toBeNull();
    expect(verifyRtToken('.', SECRET)).toBeNull();
  });
});
