import { ApiError, api } from './api.ts';

/**
 * Phase 10 — browser-side interview capture.
 *
 * Phase 9's media plane is a peer-to-peer mesh with no SFU, so there is no
 * server-side stream to record. Capture therefore happens in ONE elected
 * interviewer's tab: we record the interview TAB itself — both video tiles, the
 * code pad, the whiteboard, the pinned question, whatever is on screen — mix
 * every participant's audio into it, and POST each finished chunk to the api.
 * Chunking (rather than one blob at the end) means a crash costs seconds, not
 * the whole interview.
 *
 * Recording the tab rather than a camera track is the whole point: a review of
 * a technical interview that cannot show the candidate's code is not a review.
 *
 * Nothing here decides WHO records — that is `electRecorder` in
 * @code-nexus/types, so both peers agree without negotiating.
 */

/** Timeslice per chunk. Small enough to bound loss, large enough to stay cheap. */
const CHUNK_MS = 5000;
const MAX_RETRIES = 3;

/**
 * Preference order for the output container. Chrome/Firefox take the first;
 * Safari historically only manages mp4. Whatever the browser accepts is what we
 * store — the api never transcodes.
 */
const MIME_CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
  'video/mp4',
];

/**
 * The Content-Type to upload a chunk under.
 *
 * A MediaRecorder blob is typed with its full codec string
 * (`video/webm;codecs=vp9,opus`), whose unquoted comma is NOT a legal
 * media-type parameter. Strict parsers reject the whole header and hand the
 * route an empty body, so send the base type only — the codec detail is already
 * recorded once, on the recording row, via `start`.
 */
function chunkContentType(blob: Blob): string {
  return blob.type.split(';')[0]!.trim() || 'video/webm';
}

export function pickMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  return MIME_CANDIDATES.find((t) => MediaRecorder.isTypeSupported(t)) ?? null;
}

/** Whether this browser can record at all (Safari/older browsers may not). */
export function isRecordingSupported(): boolean {
  return typeof MediaRecorder !== 'undefined' && pickMimeType() !== null;
}

export interface RecorderCallbacks {
  /** Capture actually began (the indicator should light up). */
  onStarted?: () => void;
  /** Terminal problem — recording stopped, but the interview continues. */
  onError?: (message: string) => void;
  /** A chunk could not be uploaded after retries; media was lost. */
  onChunkLost?: (ordinal: number) => void;
  /** The interviewer stopped sharing, so capture ended before the call did. */
  onStopped?: () => void;
  /**
   * The tab could not be captured and we fell back to a camera track. Never
   * silent: a camera-only file is exactly what someone reviewing the code later
   * will find missing, and by then it cannot be fixed.
   */
  onCameraOnly?: () => void;
}

/**
 * Records the interview tab and uploads it in chunks.
 *
 * Audio is composited through an AudioContext so BOTH voices land in the file —
 * a recording with only the interviewer's side is a broken artifact, not a
 * partial one. The graph stays open for the whole session so peers who join
 * after capture began can be mixed in as they arrive.
 */
export class InterviewRecorder {
  private recorder: MediaRecorder | null = null;
  private audioCtx: AudioContext | null = null;
  private dest: MediaStreamAudioDestinationNode | null = null;
  /** Streams already wired into the mix, so a re-render cannot double them. */
  private readonly mixedIn = new WeakSet<MediaStream>();
  private audioSources = 0;
  /** Tracks this recorder created and must therefore stop itself. */
  private readonly owned: MediaStreamTrack[] = [];
  private ordinal = 0;
  private startedAtMs = 0;
  private stopping = false;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly interviewPublicId: string,
    private readonly cb: RecorderCallbacks = {},
  ) {}

  get active(): boolean {
    return this.recorder?.state === 'recording';
  }

  /**
   * Begin capture of the interview tab, falling back to the call's camera
   * tracks if tab capture is unavailable.
   *
   * MUST be called from a user gesture: `getDisplayMedia` requires one, and it
   * is also what lets the AudioContext start in the `running` state rather than
   * suspended (a suspended context silently records silence).
   *
   * Returns false when nothing could be captured — the caller should surface
   * that honestly rather than pretending the session is being saved.
   */
  async start(local: MediaStream, remotes: MediaStream[]): Promise<boolean> {
    const mimeType = pickMimeType();
    if (!mimeType) {
      this.cb.onError?.('This browser cannot record (MediaRecorder unsupported)');
      return false;
    }

    try {
      const mixed = new MediaStream();

      const videoTrack = await this.captureTab(local, remotes);
      if (videoTrack) mixed.addTrack(videoTrack);

      // Audio: everyone, mixed down to one track. The destination is created up
      // front and kept, so `addPeer` can attach latecomers to the same track.
      const ctx = new AudioContext();
      const dest = ctx.createMediaStreamDestination();
      this.audioCtx = ctx;
      this.dest = dest;
      for (const s of [local, ...remotes]) this.addPeer(s);
      const mixedAudio = dest.stream.getAudioTracks()[0];
      if (mixedAudio) {
        mixed.addTrack(mixedAudio);
        this.owned.push(mixedAudio);
      }

      if (!videoTrack && this.audioSources === 0) {
        this.cb.onError?.('Nothing to record (no screen, camera or microphone)');
        this.cleanup();
        return false;
      }

      await api.post(`/recordings/${this.interviewPublicId}/start`, { mimeType });

      const recorder = new MediaRecorder(mixed, { mimeType });
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) this.enqueue(e.data);
      };
      recorder.onerror = () => this.cb.onError?.('Recording stopped unexpectedly');

      this.recorder = recorder;
      this.startedAtMs = Date.now();
      recorder.start(CHUNK_MS);
      this.cb.onStarted?.();
      return true;
    } catch {
      this.cb.onError?.('Could not start recording');
      this.cleanup();
      return false;
    }
  }

  /**
   * Capture the interview tab.
   *
   * `preferCurrentTab` turns the browser's picker into a one-click approval of
   * THIS tab instead of a hunt through a window list, and the resulting track
   * carries everything the interviewer sees. Tab AUDIO is deliberately not
   * requested: every voice in the room is already mixed from the peer streams,
   * and taking it twice would double each speaker over themselves.
   *
   * Declining is not fatal — camera-only capture is worse than the tab, but far
   * better than losing the interview.
   */
  private async captureTab(
    local: MediaStream,
    remotes: MediaStream[],
  ): Promise<MediaStreamTrack | null> {
    if (navigator.mediaDevices?.getDisplayMedia) {
      try {
        const display = await navigator.mediaDevices.getDisplayMedia({
          video: { displaySurface: 'browser', frameRate: 15 },
          audio: false,
          // Kept to exactly this one hint on purpose: Chrome REJECTS
          // `preferCurrentTab` outright when it is combined with
          // selfBrowserSurface / surfaceSwitching / systemAudio, and that
          // rejection would look identical to the interviewer declining.
          preferCurrentTab: true,
        } as DisplayMediaStreamOptions);

        const track = display.getVideoTracks()[0];
        if (track) {
          this.owned.push(track);
          // "Stop sharing" in the browser's own bar must end capture cleanly,
          // not leave a recorder attached to a dead track.
          track.addEventListener('ended', () => {
            this.cb.onStopped?.();
            void this.stop();
          });
          return track;
        }
      } catch {
        /* declined, dismissed, or unsupported — fall through to the camera */
      }
    }
    this.cb.onCameraOnly?.();
    // The candidate is what a reviewer wants to see, so prefer a remote camera.
    return remotes.flatMap((s) => s.getVideoTracks())[0] ?? local.getVideoTracks()[0] ?? null;
  }

  /**
   * Mix one participant's audio into the recording. Safe to call repeatedly and
   * for peers who arrive long after capture began — which is the normal case,
   * since recording starts when the room opens rather than when the candidate
   * finally joins.
   */
  addPeer(stream: MediaStream): void {
    const ctx = this.audioCtx;
    const dest = this.dest;
    if (!ctx || !dest) return;
    if (stream.getAudioTracks().length === 0) return;
    if (this.mixedIn.has(stream)) return;
    this.mixedIn.add(stream);
    ctx.createMediaStreamSource(stream).connect(dest);
    this.audioSources += 1;
  }

  /**
   * Upload chunks strictly in order. Serializing through a promise chain keeps
   * ordinals monotonic even when one upload is slow — out-of-order chunks would
   * play back scrambled.
   */
  private enqueue(blob: Blob): void {
    const ordinal = this.ordinal++;
    const startOffsetMs = Math.max(0, Date.now() - this.startedAtMs - CHUNK_MS);
    this.queue = this.queue.then(() => this.upload(blob, ordinal, startOffsetMs));
  }

  private async upload(blob: Blob, ordinal: number, startOffsetMs: number): Promise<void> {
    const qs = `ordinal=${ordinal}&startOffsetMs=${startOffsetMs}&durationMs=${CHUNK_MS}`;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
      try {
        await api.postBinary(
          `/recordings/${this.interviewPublicId}/chunk?${qs}`,
          blob,
          chunkContentType(blob),
        );
        return;
      } catch (err) {
        if (err instanceof ApiError) {
          // 409 means an earlier attempt DID land and only its response was
          // lost — the bytes are stored, so this is a success, not a hole.
          if (err.status === 409) return;
          // Any other 4xx is a rejection this chunk will keep earning; burning
          // the remaining attempts only delays telling the user.
          if (err.status < 500 && err.status !== 429) break;
        }
        // Back off briefly; a transient network blip is the common case.
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      }
    }
    // Be honest that media was lost rather than silently producing a file with
    // a hole in it.
    this.cb.onChunkLost?.(ordinal);
  }

  /** Stop capture and finalize the recording (waits for in-flight uploads). */
  async stop(): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    const rec = this.recorder;
    if (rec && rec.state !== 'inactive') {
      // `requestData` flushes the tail of the current timeslice first.
      const flushed = new Promise<void>((resolve) => {
        rec.onstop = () => resolve();
      });
      rec.requestData();
      rec.stop();
      await flushed;
    }
    await this.queue;
    try {
      await api.post(`/recordings/${this.interviewPublicId}/complete`, {
        durationMs: Date.now() - this.startedAtMs,
      });
    } catch {
      /* the api finalizes on interview end anyway */
    }
    this.cleanup();
  }

  private cleanup(): void {
    // Only the tracks we created are ours to stop — the call's own camera and
    // microphone belong to the RTC session and must keep flowing.
    for (const t of this.owned.splice(0)) t.stop();
    void this.audioCtx?.close().catch(() => undefined);
    this.audioCtx = null;
    this.dest = null;
    this.recorder = null;
  }
}
