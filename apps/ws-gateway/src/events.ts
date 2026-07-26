import { toOffsetMs, type InterviewEventKind, type InterviewSurface } from '@code-nexus/types';

/**
 * Phase 10 — the interview event log.
 *
 * The gateway already observes every frame in a room, which makes it the natural
 * place to record the timeline a reviewer later scrubs through. What it records
 * is deliberately narrow: DISCRETE ACTS ONLY.
 *
 * `code:update` fires on every debounced keystroke and `whiteboard:stroke` on
 * every drag segment. Neither is logged. "The candidate was typing" is not a
 * moment anyone seeks to, and writing those 1:1 would bury the ~20 marks that
 * matter under tens of thousands of rows. Chat is likewise excluded — Phase 9
 * made interview chat ephemeral on purpose, and the timeline must not quietly
 * turn it durable.
 *
 * Everything here is PURE: the buffer is a plain array and flushing is an
 * injected callback, so ordering, offsets and the exclusion rules are all
 * unit-testable without a socket or a database.
 */

export interface PendingEvent {
  interviewId: string;
  kind: InterviewEventKind;
  offsetMs: number;
  actorUserId: string | null;
  label: string | null;
  meta?: Record<string, unknown>;
}

/** How the buffer decides to drain: whichever trigger fires first. */
export const EVENT_FLUSH_INTERVAL_MS = 2000;
export const EVENT_FLUSH_MAX_BUFFERED = 50;

/**
 * Translate a room happening into a timeline row, or null if it does not earn
 * one. The null cases are the point of this function — keep them explicit so the
 * "no keystroke rows" guarantee is testable rather than incidental.
 */
export function buildEvent(input: {
  interviewId: string;
  startedAt: Date | null;
  at: Date | number;
  kind: InterviewEventKind;
  actorUserId?: string | null;
  label?: string | null;
  meta?: Record<string, unknown>;
}): PendingEvent | null {
  const offsetMs = toOffsetMs(input.at, input.startedAt);
  // An interview that never went live has no timeline to place anything on.
  if (offsetMs == null) return null;
  return {
    interviewId: input.interviewId,
    kind: input.kind,
    offsetMs,
    actorUserId: input.actorUserId ?? null,
    label: input.label ?? null,
    ...(input.meta ? { meta: input.meta } : {}),
  };
}

/** Human label for a surface switch, shown on the player's chapter rail. */
export function surfaceEventLabel(surface: InterviewSurface): string {
  switch (surface) {
    case 'code':
      return 'Code editor';
    case 'board':
      return 'Whiteboard';
    default:
      return 'Video call';
  }
}

/**
 * A batching sink for timeline rows.
 *
 * Interviews are low-volume by design (see above), but batching still keeps a
 * burst of joins/switches from becoming one INSERT per frame, and guarantees a
 * final drain when the room empties so nothing is lost on the last participant
 * leaving.
 */
export class EventBuffer {
  private pending: PendingEvent[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly flushFn: (events: PendingEvent[]) => Promise<void>,
    private readonly maxBuffered: number = EVENT_FLUSH_MAX_BUFFERED,
  ) {}

  /** Begin periodic draining. Safe to call once at boot. */
  start(intervalMs: number = EVENT_FLUSH_INTERVAL_MS): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.flush(), intervalMs);
    // Never hold the process open just to drain a timeline.
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Queue an event; a null (unloggable) input is ignored. */
  add(event: PendingEvent | null): void {
    if (!event) return;
    this.pending.push(event);
    if (this.pending.length >= this.maxBuffered) void this.flush();
  }

  size(): number {
    return this.pending.length;
  }

  /**
   * Drain the buffer. Failures are swallowed on purpose: a timeline row is
   * review metadata, and losing one must never break a live interview.
   */
  async flush(): Promise<void> {
    if (this.pending.length === 0) return;
    const batch = this.pending;
    this.pending = [];
    try {
      await this.flushFn(batch);
    } catch {
      /* the interview matters more than its timeline */
    }
  }
}
