import { describe, expect, it } from 'vitest';
import {
  canAdmitToRoom,
  canDrawOnWhiteboard,
  canEditSharedCode,
  canSwitchSurface,
  needsAdmission,
  feedbackCreateSchema,
  interviewClientMessageSchema,
  interviewCreateSchema,
  interviewChannel,
  interviewQuestionBankQuerySchema,
  interviewQuestionSetSchema,
  isOfferer,
  INTERVIEW_SURFACES,
} from './interview.js';

const uuid = '00000000-0000-0000-0000-000000000001';

describe('interviewCreateSchema', () => {
  it('accepts a minimal valid schedule', () => {
    expect(
      interviewCreateSchema.safeParse({
        candidateStudentPublicId: uuid,
        scheduledStartsAt: new Date().toISOString(),
        durationMinutes: 45,
      }).success,
    ).toBe(true);
  });
  it('rejects a bad duration / bad candidate id', () => {
    expect(
      interviewCreateSchema.safeParse({
        candidateStudentPublicId: 'nope',
        scheduledStartsAt: new Date().toISOString(),
        durationMinutes: 45,
      }).success,
    ).toBe(false);
    expect(
      interviewCreateSchema.safeParse({
        candidateStudentPublicId: uuid,
        scheduledStartsAt: new Date().toISOString(),
        durationMinutes: 5,
      }).success,
    ).toBe(false);
  });
});

describe('feedbackCreateSchema', () => {
  it('bounds the rating and requires notes + recommendation', () => {
    expect(
      feedbackCreateSchema.safeParse({ rating: 4, notes: 'solid', recommendation: 'YES' }).success,
    ).toBe(true);
    expect(
      feedbackCreateSchema.safeParse({ rating: 9, notes: 'x', recommendation: 'YES' }).success,
    ).toBe(false);
    expect(
      feedbackCreateSchema.safeParse({ rating: 3, notes: '', recommendation: 'YES' }).success,
    ).toBe(false);
  });
  it('accepts an optional application advance target', () => {
    const r = feedbackCreateSchema.safeParse({
      rating: 5,
      notes: 'hire',
      recommendation: 'STRONG_YES',
      advanceApplicationTo: 'OFFERED',
    });
    expect(r.success).toBe(true);
  });
});

describe('interviewClientMessageSchema (inbound frames)', () => {
  it('validates rtc / code / whiteboard / chat / heartbeat', () => {
    expect(
      interviewClientMessageSchema.safeParse({ t: 'rtc:offer', to: 'p2', sdp: 'v=0' }).success,
    ).toBe(true);
    expect(
      interviewClientMessageSchema.safeParse({ t: 'rtc:ice', to: 'p2', candidate: { x: 1 } })
        .success,
    ).toBe(true);
    expect(
      interviewClientMessageSchema.safeParse({ t: 'code:update', content: 'x=1' }).success,
    ).toBe(true);
    expect(
      interviewClientMessageSchema.safeParse({ t: 'whiteboard:stroke', stroke: [1, 2] }).success,
    ).toBe(true);
    expect(interviewClientMessageSchema.safeParse({ t: 'chat:send', body: 'hi' }).success).toBe(
      true,
    );
    expect(interviewClientMessageSchema.safeParse({ t: 'presence:heartbeat' }).success).toBe(true);
  });
  it('rejects junk and an empty chat body', () => {
    expect(interviewClientMessageSchema.safeParse({ t: 'nope' }).success).toBe(false);
    expect(interviewClientMessageSchema.safeParse({ t: 'chat:send', body: '' }).success).toBe(
      false,
    );
    expect(interviewClientMessageSchema.safeParse({ t: 'rtc:offer', sdp: 'v=0' }).success).toBe(
      false,
    );
  });
});

describe('isOfferer (glare avoidance)', () => {
  it('exactly one peer per pair offers, deterministically', () => {
    expect(isOfferer('aaa', 'bbb')).toBe(true);
    expect(isOfferer('bbb', 'aaa')).toBe(false);
    // Symmetric: never both, never neither.
    const a = isOfferer('peer-1', 'peer-2');
    const b = isOfferer('peer-2', 'peer-1');
    expect(a).not.toBe(b);
  });
});

describe('interviewChannel', () => {
  it('namespaces by id', () => {
    expect(interviewChannel('abc')).toBe('interview:abc');
  });
});

describe('shared surfaces', () => {
  it('accepts every surface on the wire and rejects anything else', () => {
    for (const surface of INTERVIEW_SURFACES) {
      expect(interviewClientMessageSchema.safeParse({ t: 'surface:set', surface }).success).toBe(
        true,
      );
    }
    expect(
      interviewClientMessageSchema.safeParse({ t: 'surface:set', surface: 'terminal' }).success,
    ).toBe(false);
    expect(interviewClientMessageSchema.safeParse({ t: 'surface:set' }).success).toBe(false);
  });

  it('lets anyone move the room — a candidate reaching for the whiteboard is the point', () => {
    expect(canSwitchSurface('CANDIDATE')).toBe(true);
    expect(canSwitchSurface('INTERVIEWER')).toBe(true);
  });
});

describe('in-room write rules', () => {
  it('gives the shared IDE to the candidate alone', () => {
    expect(canEditSharedCode('CANDIDATE')).toBe(true);
    // Interviewers watch the candidate's keystrokes but can never type.
    expect(canEditSharedCode('INTERVIEWER')).toBe(false);
    expect(canEditSharedCode('HOST')).toBe(false);
    expect(canEditSharedCode('VIEWER')).toBe(false);
  });

  it('keeps the whiteboard collaborative for both sides', () => {
    // The asymmetry with the IDE is deliberate, so assert it rather than
    // leaving it to be re-derived from a comment.
    expect(canDrawOnWhiteboard('CANDIDATE')).toBe(true);
    expect(canDrawOnWhiteboard('INTERVIEWER')).toBe(true);
  });
});

describe('live question pinning', () => {
  it('accepts a slug and accepts an explicit clear', () => {
    expect(interviewQuestionSetSchema.safeParse({ slug: 'two-sum' }).success).toBe(true);
    expect(interviewQuestionSetSchema.safeParse({ slug: null }).success).toBe(true);
    // Absent is not the same as cleared — the caller must be explicit.
    expect(interviewQuestionSetSchema.safeParse({}).success).toBe(false);
    expect(interviewQuestionSetSchema.safeParse({ slug: '' }).success).toBe(false);
  });

  it('defaults the bank query to a bounded first page', () => {
    const parsed = interviewQuestionBankQuerySchema.parse({});
    expect(parsed.page).toBe(1);
    expect(parsed.pageSize).toBe(20);
    expect(interviewQuestionBankQuerySchema.safeParse({ pageSize: 500 }).success).toBe(false);
    expect(interviewQuestionBankQuerySchema.safeParse({ difficulty: 'IMPOSSIBLE' }).success).toBe(
      false,
    );
  });
});

describe('lobby admission rules', () => {
  it('makes the candidate wait and lets the interviewers in', () => {
    expect(needsAdmission('CANDIDATE')).toBe(true);
    expect(needsAdmission('INTERVIEWER')).toBe(false);
    expect(needsAdmission('HOST')).toBe(false);
  });

  it('never lets one role both wait at the door and open it', () => {
    // The two rules are complements by construction; assert it so a future edit
    // cannot quietly produce a candidate who admits themselves.
    for (const role of ['CANDIDATE', 'INTERVIEWER', 'HOST', 'VIEWER'] as const) {
      expect(canAdmitToRoom(role)).toBe(!needsAdmission(role));
    }
  });

  it('accepts admit/deny frames and rejects a missing target', () => {
    expect(
      interviewClientMessageSchema.safeParse({ t: 'lobby:admit', peerId: 'p_abc' }).success,
    ).toBe(true);
    expect(
      interviewClientMessageSchema.safeParse({ t: 'lobby:deny', peerId: 'p_abc' }).success,
    ).toBe(true);
    expect(interviewClientMessageSchema.safeParse({ t: 'lobby:admit' }).success).toBe(false);
    expect(interviewClientMessageSchema.safeParse({ t: 'lobby:admit', peerId: '' }).success).toBe(
      false,
    );
  });
});
