import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, Trash2 } from 'lucide-react';
import {
  EVENT_KIND_LABEL,
  formatOffset,
  type InterviewEventDto,
  type RecordingDetail,
  type RecordingPlaybackResponse,
} from '@code-nexus/types';
import { api, ApiError, apiUrl } from '../../lib/api.ts';
import { formatDateTime } from '../../lib/interviews.ts';
import { formatDuration, recordingKeys } from '../../lib/recordings.ts';
import { AppShell } from '../../components/dashboard/AppShell.tsx';
import { Panel } from '../../components/dashboard/Panel.tsx';
import { QueryState } from '../../components/dashboard/QueryState.tsx';

/**
 * Review player: the recorded video plus a timeline chaptered by what actually
 * happened in the room (surface switches, code runs, joins/leaves).
 *
 * A recording is STORED as a sequence of chunks but is a single continuous
 * stream: the segments are concatenated back into one file before playback, so
 * the element gets one timeline and "seek to 12:30" is just a `currentTime`.
 */
export function RecordingPlayer() {
  const { publicId = '' } = useParams();

  const detail = useQuery({
    queryKey: recordingKeys.detail(publicId),
    queryFn: () => api.get<RecordingDetail>(`/recordings/${publicId}`),
  });
  const playback = useQuery({
    queryKey: recordingKeys.playback(publicId),
    queryFn: () => api.get<RecordingPlaybackResponse>(`/recordings/${publicId}/playback`),
    enabled: detail.data?.status === 'READY',
  });

  return (
    <AppShell title="Recording">
      <Link
        to="/app/recordings"
        className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-fg"
      >
        <ArrowLeft className="h-4 w-4" /> Recordings
      </Link>
      <QueryState
        isLoading={detail.isLoading}
        isError={detail.isError}
        onRetry={() => detail.refetch()}
      >
        {detail.data ? (
          detail.data.status === 'READY' ? (
            <Player detail={detail.data} playback={playback.data} publicId={publicId} />
          ) : (
            <Panel title={detail.data.interviewTitle ?? 'Recording'}>
              <p className="text-[13px] text-muted">
                {detail.data.status === 'FAILED'
                  ? 'This recording failed — no media was captured.'
                  : detail.data.status === 'RECORDING'
                    ? 'This interview is still being recorded.'
                    : 'This recording is not available.'}
              </p>
            </Panel>
          )
        ) : null}
      </QueryState>
    </AppShell>
  );
}

function Player({
  detail,
  playback,
  publicId,
}: {
  detail: RecordingDetail;
  playback: RecordingPlaybackResponse | undefined;
  publicId: string;
}) {
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(0);
  const [loadFailed, setLoadFailed] = useState(false);

  // Memoized so the `?? []` fallback does not mint a new array every render and
  // re-run the stitching effect on every render.
  const segments = useMemo(() => playback?.segments ?? [], [playback]);

  /**
   * Reassemble the segments into ONE file before playing.
   *
   * MediaRecorder emits a stream, not a series of files: only the first chunk
   * carries the WebM header, and every later chunk is a bare cluster
   * continuation that no player can open on its own. They are meant to be
   * concatenated back into the single recording they came from — which also
   * gives the element one continuous timeline to seek across, instead of six
   * five-second islands.
   */
  useEffect(() => {
    if (segments.length === 0) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    setLoaded(0);
    setLoadFailed(false);

    void (async () => {
      try {
        const parts: Blob[] = [];
        for (const s of segments) {
          // Sequential on purpose: the concatenation is only valid in ordinal
          // order, and this keeps one interview's worth of media off the wire
          // all at once.
          const res = await fetch(apiUrl(s.url), { credentials: 'include' });
          if (!res.ok) throw new Error(`segment ${s.ordinal} → ${res.status}`);
          if (cancelled) return;
          parts.push(await res.blob());
          setLoaded(parts.length);
        }
        if (cancelled) return;
        objectUrl = URL.createObjectURL(new Blob(parts, { type: detail.mimeType }));
        setSrc(objectUrl);
      } catch {
        if (!cancelled) setLoadFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [segments, detail.mimeType]);

  /**
   * Where capture began on the interview's clock. Timeline events are stamped
   * from the interview's start, but the video starts when the second peer
   * arrived — without this offset every chapter would seek to the wrong moment.
   */
  const captureStartMs = useMemo(
    () => detail.events.find((e) => e.kind === 'RECORDING_STARTED')?.offsetMs ?? 0,
    [detail.events],
  );

  /** Seek the recording to an interview-clock offset. */
  const seekTo = useCallback(
    (offsetMs: number) => {
      const el = videoRef.current;
      if (!el) return;
      el.currentTime = Math.max(0, (offsetMs - captureStartMs) / 1000);
      void el.play().catch(() => undefined);
    },
    [captureStartMs],
  );

  // Track elapsed time on the interview's clock so the chapter rail can show
  // what is active.
  const onTimeUpdate = (): void => {
    const el = videoRef.current;
    if (el) setElapsedMs(captureStartMs + el.currentTime * 1000);
  };

  /**
   * MediaRecorder never writes a duration into the container, so the element
   * reports `Infinity` and refuses to scrub. Driving the playhead past any
   * plausible end forces the browser to scan to the last cluster and settle on
   * the real duration; then we put it back at the start.
   */
  const onLoadedMetadata = (): void => {
    const el = videoRef.current;
    if (!el || Number.isFinite(el.duration)) return;
    const settle = (): void => {
      el.removeEventListener('seeked', settle);
      el.currentTime = 0;
    };
    el.addEventListener('seeked', settle);
    try {
      el.currentTime = 1e7;
    } catch {
      el.removeEventListener('seeked', settle);
    }
  };

  const del = useMutation({
    mutationFn: () => api.del(`/recordings/${publicId}`),
    onSuccess: () => navigate('/app/recordings'),
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not delete the recording'),
  });

  return (
    <div className="space-y-4">
      <Panel
        title={detail.interviewTitle ?? `Interview with ${detail.candidateName}`}
        action={
          detail.canDelete ? (
            <button
              type="button"
              disabled={del.isPending}
              onClick={() => {
                if (confirm('Delete this recording permanently? The video files are erased.')) {
                  del.mutate();
                }
              }}
              className="inline-flex items-center gap-1.5 text-[12px] font-medium text-danger hover:underline disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </button>
          ) : null
        }
      >
        {error ? <p className="mb-3 text-[12px] text-danger">{error}</p> : null}
        <p className="mb-3 text-[13px] text-muted">
          {detail.candidateName} · {formatDateTime(detail.startedAt)} ·{' '}
          {formatDuration(detail.durationMs)}
        </p>

        <div className="overflow-hidden rounded-xl border border-line bg-black">
          {src ? (
            <video
              ref={videoRef}
              key={src}
              src={src}
              controls
              playsInline
              onTimeUpdate={onTimeUpdate}
              onLoadedMetadata={onLoadedMetadata}
              className="aspect-video w-full"
            >
              {/* Captions are not generated yet, but the track slot is here so a
                  future transcription pass is a drop-in rather than a rewrite. */}
              Your browser cannot play this recording.
            </video>
          ) : (
            <div className="flex aspect-video w-full items-center justify-center text-[13px] text-white/50">
              {loadFailed
                ? 'This recording could not be loaded.'
                : segments.length > 0
                  ? `Preparing playback… ${loaded} of ${segments.length} parts`
                  : 'Preparing playback…'}
            </div>
          )}
        </div>
      </Panel>

      <Panel title="Timeline">
        <ChapterRail events={detail.events} elapsedMs={elapsedMs} onSeek={seekTo} />
      </Panel>
    </div>
  );
}

/**
 * The chapter list. Real `<button>`s (not click-handling divs) so the timeline is
 * keyboard-navigable — a reviewer can tab through the moments of an interview.
 */
function ChapterRail({
  events,
  elapsedMs,
  onSeek,
}: {
  events: InterviewEventDto[];
  elapsedMs: number;
  onSeek: (offsetMs: number) => void;
}) {
  if (events.length === 0) {
    return (
      <p className="py-6 text-center text-[13px] text-muted">
        No timeline events were recorded for this interview.
      </p>
    );
  }

  // The active chapter is the last one at or before the playhead.
  const activeIndex = events.reduce((acc, e, i) => (e.offsetMs <= elapsedMs + 250 ? i : acc), -1);

  return (
    <ol className="space-y-1">
      {events.map((e, i) => {
        const active = i === activeIndex;
        return (
          <li key={e.publicId}>
            <button
              type="button"
              onClick={() => onSeek(e.offsetMs)}
              aria-current={active ? 'true' : undefined}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors ${
                active ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-surface-2'
              }`}
            >
              <span className="mono-label w-14 shrink-0 tabular-nums text-[10px]">
                {formatOffset(e.offsetMs)}
              </span>
              <span className="min-w-0 flex-1 truncate text-[13px]">
                <span className={active ? 'font-medium' : 'text-fg'}>
                  {EVENT_KIND_LABEL[e.kind]}
                </span>
                {e.label ? <span className="text-muted"> · {e.label}</span> : null}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
