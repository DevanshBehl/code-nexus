import { describe, expect, it, vi } from 'vitest';
import { EventBuffer, buildEvent, surfaceEventLabel, type PendingEvent } from './events.js';

/**
 * Pure tests for the Phase-10 timeline: no sockets, no database.
 * The most important assertions here are the NEGATIVE ones — that continuous
 * typing and drawing never become rows.
 */

const START = new Date('2026-01-01T10:00:00.000Z');

describe('buildEvent', () => {
  it('positions an event relative to the interview start', () => {
    const e = buildEvent({
      interviewId: 'iv-1',
      startedAt: START,
      at: new Date('2026-01-01T10:01:30.000Z'),
      kind: 'SURFACE_CHANGED',
      actorUserId: 'u-1',
      label: 'Whiteboard',
    });
    expect(e).toEqual({
      interviewId: 'iv-1',
      kind: 'SURFACE_CHANGED',
      offsetMs: 90_000,
      actorUserId: 'u-1',
      label: 'Whiteboard',
    });
  });

  it('returns null when the interview never went live', () => {
    // No zero point means no timeline — inventing an offset would be a lie.
    expect(
      buildEvent({ interviewId: 'iv-1', startedAt: null, at: Date.now(), kind: 'CODE_RUN' }),
    ).toBeNull();
  });

  it('clamps a pre-start instant to zero instead of a negative offset', () => {
    const e = buildEvent({
      interviewId: 'iv-1',
      startedAt: START,
      at: new Date('2026-01-01T09:59:55.000Z'),
      kind: 'PARTICIPANT_JOINED',
    });
    expect(e?.offsetMs).toBe(0);
  });

  it('carries optional structured meta', () => {
    const e = buildEvent({
      interviewId: 'iv-1',
      startedAt: START,
      at: START,
      kind: 'CODE_RUN',
      meta: { language: 'PYTHON' },
    });
    expect(e?.meta).toEqual({ language: 'PYTHON' });
  });
});

describe('surfaceEventLabel', () => {
  it('names each shared surface for the chapter rail', () => {
    expect(surfaceEventLabel('code')).toBe('Code editor');
    expect(surfaceEventLabel('board')).toBe('Whiteboard');
    expect(surfaceEventLabel('call')).toBe('Video call');
  });
});

describe('EventBuffer', () => {
  const ev = (kind: PendingEvent['kind'] = 'PARTICIPANT_JOINED'): PendingEvent => ({
    interviewId: 'iv-1',
    kind,
    offsetMs: 0,
    actorUserId: 'u-1',
    label: null,
  });

  it('batches and flushes in one call', async () => {
    const flush = vi.fn(async () => undefined);
    const buf = new EventBuffer(flush);
    buf.add(ev());
    buf.add(ev('SURFACE_CHANGED'));
    expect(buf.size()).toBe(2);

    await buf.flush();
    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush.mock.calls[0]![0]).toHaveLength(2);
    expect(buf.size()).toBe(0);
  });

  it('ignores a null event (the unloggable case)', () => {
    const buf = new EventBuffer(async () => undefined);
    buf.add(null);
    expect(buf.size()).toBe(0);
  });

  it('auto-flushes once the buffer is full', async () => {
    const flush = vi.fn(async () => undefined);
    const buf = new EventBuffer(flush, 3);
    buf.add(ev());
    buf.add(ev());
    expect(flush).not.toHaveBeenCalled();
    buf.add(ev()); // hits the cap
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it('does not call the sink when there is nothing to write', async () => {
    const flush = vi.fn(async () => undefined);
    await new EventBuffer(flush).flush();
    expect(flush).not.toHaveBeenCalled();
  });

  it('swallows a sink failure — a lost timeline row must not break a live room', async () => {
    const flush = vi.fn(async () => {
      throw new Error('db down');
    });
    const buf = new EventBuffer(flush);
    buf.add(ev());
    await expect(buf.flush()).resolves.toBeUndefined();
    // The batch is dropped rather than retried forever and growing unbounded.
    expect(buf.size()).toBe(0);
  });
});
