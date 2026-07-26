import { describe, expect, it } from 'vitest';
import {
  attendanceOnHeartbeat,
  attendanceOnJoin,
  attendanceOnLeave,
  attendedSecondsNow,
  newBucket,
  pollCreateSchema,
  rtClientMessageSchema,
  takeToken,
  webinarChannel,
  webinarCreateSchema,
  CHAT_RATE,
  type AttendanceState,
} from './webinar.js';

describe('webinarCreateSchema', () => {
  it('accepts a valid draft', () => {
    const r = webinarCreateSchema.safeParse({
      title: 'Pre-placement talk',
      description: 'Meet the team.',
      scheduledStartsAt: new Date().toISOString(),
    });
    expect(r.success).toBe(true);
  });
  it('rejects a short title and a bad date', () => {
    expect(
      webinarCreateSchema.safeParse({ title: 'x', description: 'y', scheduledStartsAt: 'no' })
        .success,
    ).toBe(false);
  });
});

describe('pollCreateSchema', () => {
  it('requires 2–6 options', () => {
    expect(pollCreateSchema.safeParse({ question: 'Q?', options: ['a'] }).success).toBe(false);
    expect(pollCreateSchema.safeParse({ question: 'Q?', options: ['a', 'b'] }).success).toBe(true);
    expect(
      pollCreateSchema.safeParse({ question: 'Q?', options: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] })
        .success,
    ).toBe(false);
  });
});

describe('rtClientMessageSchema (inbound frame validation)', () => {
  it('validates chat / vote / heartbeat and rejects junk', () => {
    expect(rtClientMessageSchema.safeParse({ t: 'chat:send', body: 'hi' }).success).toBe(true);
    expect(rtClientMessageSchema.safeParse({ t: 'chat:send', body: '' }).success).toBe(false);
    expect(
      rtClientMessageSchema.safeParse({
        t: 'poll:vote',
        pollId: '00000000-0000-0000-0000-000000000000',
        optionId: '00000000-0000-0000-0000-000000000000',
      }).success,
    ).toBe(true);
    expect(rtClientMessageSchema.safeParse({ t: 'presence:heartbeat' }).success).toBe(true);
    expect(rtClientMessageSchema.safeParse({ t: 'nope' }).success).toBe(false);
  });
});

describe('webinarChannel', () => {
  it('namespaces by id', () => {
    expect(webinarChannel('abc')).toBe('webinar:abc');
  });
});

describe('attendance accumulation (dedupes reconnects, no double-count)', () => {
  it('sums connected intervals across a leave/rejoin', () => {
    const t0 = 1_000_000;
    let s = attendanceOnJoin(null, t0); // present
    s = attendanceOnLeave(s, t0 + 30_000); // 30s
    expect(s.attendedSeconds).toBe(30);
    expect(s.present).toBe(false);
    s = attendanceOnJoin(s, t0 + 60_000); // rejoin
    s = attendanceOnLeave(s, t0 + 90_000); // +30s
    expect(s.attendedSeconds).toBe(60);
  });

  it('a duplicate/overlapping join does not reset the running interval', () => {
    const t0 = 5_000_000;
    let s = attendanceOnJoin(null, t0);
    s = attendanceOnJoin(s, t0 + 10_000); // second socket while already present
    s = attendanceOnLeave(s, t0 + 40_000);
    // Still one continuous 40s interval — not restarted at +10s.
    expect(s.attendedSeconds).toBe(40);
  });

  it('attendedSecondsNow folds an in-progress interval; heartbeat does not add', () => {
    const t0 = 9_000_000;
    let s: AttendanceState = attendanceOnJoin(null, t0);
    s = attendanceOnHeartbeat(s, t0 + 20_000);
    expect(s.attendedSeconds).toBe(0); // not folded until leave
    expect(attendedSecondsNow(s, t0 + 25_000)).toBe(25);
  });

  it('leave while already absent is a no-op on the total', () => {
    const t0 = 2_000_000;
    let s = attendanceOnJoin(null, t0);
    s = attendanceOnLeave(s, t0 + 10_000);
    s = attendanceOnLeave(s, t0 + 99_000);
    expect(s.attendedSeconds).toBe(10);
  });
});

describe('token-bucket rate limiter', () => {
  it('allows a burst up to capacity then blocks, refilling over time', () => {
    const t0 = 0;
    let b = newBucket(CHAT_RATE.capacity, t0);
    let allowed = 0;
    for (let i = 0; i < CHAT_RATE.capacity; i += 1) {
      const r = takeToken(b, CHAT_RATE, t0);
      b = r.bucket;
      if (r.allowed) allowed += 1;
    }
    expect(allowed).toBe(CHAT_RATE.capacity);
    // Next one (no time passed) is blocked.
    expect(takeToken(b, CHAT_RATE, t0).allowed).toBe(false);
    // After 1s, one token refilled.
    expect(takeToken(b, CHAT_RATE, t0 + 1000).allowed).toBe(true);
  });
});
