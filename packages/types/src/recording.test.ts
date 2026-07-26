import { describe, expect, it } from 'vitest';
import type { InterviewPeer } from './interview.js';
import {
  canDeleteRecording,
  canViewRecording,
  electRecorder,
  formatOffset,
  isLoggableFrame,
  locateOffset,
  recordingChunkSchema,
  toOffsetMs,
  type RecordingViewerContext,
} from './recording.js';

const peer = (peerId: string, role: InterviewPeer['role']): InterviewPeer => ({
  peerId,
  role,
  displayName: peerId,
});

describe('electRecorder', () => {
  it('picks nobody when no interviewer is present', () => {
    expect(electRecorder([])).toBeNull();
    // A candidate alone must never start recording their own interview.
    expect(electRecorder([peer('p_a', 'CANDIDATE')])).toBeNull();
  });

  it('picks the single interviewer', () => {
    expect(electRecorder([peer('p_z', 'INTERVIEWER'), peer('p_a', 'CANDIDATE')])).toBe('p_z');
  });

  it('picks exactly one when several interviewers are present, deterministically', () => {
    const peers = [
      peer('p_m', 'INTERVIEWER'),
      peer('p_a', 'INTERVIEWER'),
      peer('p_z', 'CANDIDATE'),
    ];
    expect(electRecorder(peers)).toBe('p_a');
    // Order-independent: every client computes the same winner from any ordering.
    expect(electRecorder([...peers].reverse())).toBe('p_a');
  });

  it('never elects the candidate even if their peerId sorts first', () => {
    const peers = [peer('p_aaa', 'CANDIDATE'), peer('p_bbb', 'INTERVIEWER')];
    expect(electRecorder(peers)).toBe('p_bbb');
  });
});

describe('toOffsetMs', () => {
  const start = new Date('2026-01-01T10:00:00.000Z');

  it('measures from the interview start', () => {
    expect(toOffsetMs(new Date('2026-01-01T10:00:30.000Z'), start)).toBe(30_000);
  });

  it('clamps a pre-start instant to zero rather than going negative', () => {
    expect(toOffsetMs(new Date('2026-01-01T09:59:59.000Z'), start)).toBe(0);
  });

  it('returns null when the interview never went live', () => {
    expect(toOffsetMs(Date.now(), null)).toBeNull();
  });
});

describe('isLoggableFrame', () => {
  it('logs a surface switch', () => {
    expect(isLoggableFrame('surface:set')).toBe(true);
    expect(isLoggableFrame('surface:changed')).toBe(true);
  });

  it('IGNORES continuous typing and drawing entirely', () => {
    // The whole point: these fire constantly and are not timeline moments.
    expect(isLoggableFrame('code:update')).toBe(false);
    expect(isLoggableFrame('whiteboard:stroke')).toBe(false);
  });

  it('does not quietly make ephemeral chat or signaling durable', () => {
    expect(isLoggableFrame('chat:send')).toBe(false);
    expect(isLoggableFrame('rtc:offer')).toBe(false);
    expect(isLoggableFrame('rtc:ice')).toBe(false);
    expect(isLoggableFrame('presence:heartbeat')).toBe(false);
  });
});

describe('locateOffset (global timeline -> segment + local offset)', () => {
  // Two segments: 0..60s, then a new one starting at 65s (recorder reconnected).
  const segments = [
    { ordinal: 0, startOffsetMs: 0, durationMs: 60_000 },
    { ordinal: 1, startOffsetMs: 65_000, durationMs: 30_000 },
  ];

  it('returns null with nothing recorded', () => {
    expect(locateOffset([], 1000)).toBeNull();
  });

  it('locates inside the first segment', () => {
    expect(locateOffset(segments, 12_000)).toEqual({ ordinal: 0, localOffsetMs: 12_000 });
  });

  it('locates inside a later segment, rebased to that file', () => {
    // 70s global is 5s into segment 1 — NOT 70s into it.
    expect(locateOffset(segments, 70_000)).toEqual({ ordinal: 1, localOffsetMs: 5_000 });
  });

  it('clamps an offset before the recording began', () => {
    expect(locateOffset(segments, -5_000)).toEqual({ ordinal: 0, localOffsetMs: 0 });
  });

  it('clamps an offset past the end to the end of the last segment', () => {
    expect(locateOffset(segments, 999_999)).toEqual({ ordinal: 1, localOffsetMs: 30_000 });
  });

  it('lands in the gap between segments at the start of the next one', () => {
    // 62s falls in the dead air while the recorder reconnected.
    expect(locateOffset(segments, 62_000)).toEqual({ ordinal: 0, localOffsetMs: 60_000 });
  });

  it('is order-independent about how segments are supplied', () => {
    expect(locateOffset([...segments].reverse(), 70_000)).toEqual({
      ordinal: 1,
      localOffsetMs: 5_000,
    });
  });
});

describe('canViewRecording (the visibility matrix)', () => {
  const base: RecordingViewerContext = {
    role: 'STUDENT',
    isCandidate: false,
    isAssignedInterviewer: false,
    hostsAsCompany: false,
    hostsAsUniversity: false,
  };

  it('lets the candidate see their own interview, and no other student', () => {
    expect(canViewRecording({ ...base, role: 'STUDENT', isCandidate: true })).toBe(true);
    expect(canViewRecording({ ...base, role: 'STUDENT', isCandidate: false })).toBe(false);
  });

  it('lets only an ASSIGNED recruiter see it', () => {
    expect(canViewRecording({ ...base, role: 'RECRUITER', isAssignedInterviewer: true })).toBe(
      true,
    );
    expect(canViewRecording({ ...base, role: 'RECRUITER', isAssignedInterviewer: false })).toBe(
      false,
    );
  });

  it('scopes a company to its own interviews', () => {
    expect(canViewRecording({ ...base, role: 'COMPANY', hostsAsCompany: true })).toBe(true);
    expect(canViewRecording({ ...base, role: 'COMPANY', hostsAsCompany: false })).toBe(false);
  });

  it('scopes a university to its own students', () => {
    expect(canViewRecording({ ...base, role: 'UNIVERSITY', hostsAsUniversity: true })).toBe(true);
    expect(canViewRecording({ ...base, role: 'UNIVERSITY', hostsAsUniversity: false })).toBe(false);
  });

  it('lets admin see everything', () => {
    expect(canViewRecording({ ...base, role: 'ADMIN' })).toBe(true);
  });

  it('does not let a company see another company’s interview via candidacy flags', () => {
    // Cross-tenant leakage check: unrelated true flags must not grant access.
    expect(
      canViewRecording({ ...base, role: 'COMPANY', isCandidate: true, hostsAsUniversity: true }),
    ).toBe(false);
  });
});

describe('canDeleteRecording', () => {
  const base: RecordingViewerContext = {
    role: 'STUDENT',
    isCandidate: true,
    isAssignedInterviewer: false,
    hostsAsCompany: false,
    hostsAsUniversity: false,
  };

  it('never lets the candidate delete the record of their own interview', () => {
    expect(canDeleteRecording(base)).toBe(false);
  });

  it('does not let a mere assigned recruiter delete it', () => {
    expect(canDeleteRecording({ ...base, role: 'RECRUITER', isAssignedInterviewer: true })).toBe(
      false,
    );
  });

  it('lets the hosting org and admin delete it', () => {
    expect(canDeleteRecording({ ...base, role: 'COMPANY', hostsAsCompany: true })).toBe(true);
    expect(canDeleteRecording({ ...base, role: 'UNIVERSITY', hostsAsUniversity: true })).toBe(true);
    expect(canDeleteRecording({ ...base, role: 'ADMIN' })).toBe(true);
  });
});

describe('recordingChunkSchema', () => {
  it('coerces query strings and rejects a negative ordinal', () => {
    expect(recordingChunkSchema.parse({ ordinal: '3', startOffsetMs: '15000' })).toEqual({
      ordinal: 3,
      startOffsetMs: 15_000,
    });
    expect(recordingChunkSchema.safeParse({ ordinal: -1, startOffsetMs: 0 }).success).toBe(false);
    expect(recordingChunkSchema.safeParse({ ordinal: 0, startOffsetMs: -1 }).success).toBe(false);
  });
});

describe('formatOffset', () => {
  it('renders mm:ss and grows to h:mm:ss', () => {
    expect(formatOffset(0)).toBe('0:00');
    expect(formatOffset(9_000)).toBe('0:09');
    expect(formatOffset(754_000)).toBe('12:34');
    expect(formatOffset(3_723_000)).toBe('1:02:03');
  });
});
