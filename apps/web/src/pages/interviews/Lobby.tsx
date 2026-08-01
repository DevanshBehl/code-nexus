import { useMutation } from '@tanstack/react-query';
import { ArrowLeft, DoorOpen, Loader2, Radio, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { InterviewDetail } from '@code-nexus/types';
import { api, ApiError } from '../../lib/api.ts';
import { formatDateTime } from '../../lib/interviews.ts';
import { requestFullscreenNow } from '../../lib/roomLock.ts';
import { useDeviceCheck } from '../../lib/devices.ts';
import { DeviceCheckPanel } from '../../components/interviews/DeviceCheck.tsx';
import { InterviewStatusBadge } from '../../components/interviews/InterviewBits.tsx';

/**
 * The interview lobby — the room before the room, for BOTH sides.
 *
 * Two things happen here, and they are separate on purpose. On the left you check
 * your camera and microphone, because the alternative is discovering a dead mic
 * in front of the person interviewing you. On the right you wait for the door:
 * an interviewer opens the room and walks in, a candidate asks to be let in and
 * is admitted by a person, not by a status field.
 *
 * The candidate can stand here BEFORE the interview starts — that is the fix for
 * "the student cannot join and sees no way in". Nothing is joined early: the page
 * simply watches the interview and offers the door the moment there is one.
 */
export function Lobby({
  iv,
  publicId,
  onJoin,
  onWentLive,
}: {
  iv: InterviewDetail;
  publicId: string;
  /** Hand the checked devices to the room. */
  onJoin: (stream: MediaStream | null, micOn: boolean, camOn: boolean) => void;
  /** The interviewer started the room; refresh the detail so status flips to LIVE. */
  onWentLive: () => void;
}) {
  const check = useDeviceCheck();

  const goLive = useMutation({
    mutationFn: () => api.post(`/interviews/${publicId}/go-live`),
    onSuccess: () => {
      onWentLive();
      join();
    },
  });

  const cancel = useMutation({
    mutationFn: () => api.post(`/interviews/${publicId}/cancel`),
    onSuccess: onWentLive, // same refresh: re-read the interview, re-render the page
  });

  const join = (): void => {
    // Ask for fullscreen inside the click — the room is a locked, fullscreen
    // surface and requesting it after the mount is usually too late to be granted.
    requestFullscreenNow();
    onJoin(check.release(), check.micOn, check.camOn);
  };

  const live = iv.status === 'LIVE';
  const over = iv.status === 'ENDED' || iv.status === 'CANCELLED';

  return (
    <div className="min-h-screen bg-bg">
      <div className="mx-auto w-full max-w-5xl px-4 py-6">
        <Link
          to="/app/interviews"
          className="mb-5 inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-fg"
        >
          <ArrowLeft className="h-4 w-4" /> Interviews
        </Link>

        <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr] lg:items-start">
          <DeviceCheckPanel check={check} />

          <div className="rounded-2xl border border-line bg-surface p-5">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <h1 className="text-[17px] font-semibold tracking-tight text-fg">
                {iv.title ?? 'Interview'}
              </h1>
              <InterviewStatusBadge status={iv.status} />
            </div>
            <p className="text-[13px] leading-relaxed text-muted">
              {formatDateTime(iv.scheduledStartsAt)} · {iv.durationMinutes} min ·{' '}
              {iv.canManage ? (
                <>
                  candidate <strong className="text-fg">{iv.candidate.displayName}</strong>
                </>
              ) : (
                <>
                  hosted by <strong className="text-fg">{iv.host.name}</strong>
                </>
              )}
            </p>

            <div className="mt-5 border-t border-line pt-5">
              {over ? (
                <Over iv={iv} />
              ) : iv.canManage ? (
                <HostAction
                  live={live}
                  pending={goLive.isPending || cancel.isPending}
                  error={goLive.error ?? cancel.error}
                  onGoLive={() => goLive.mutate()}
                  onJoin={join}
                  onCancel={() => {
                    if (confirm('Cancel this interview? The candidate will not be able to join.')) {
                      cancel.mutate();
                    }
                  }}
                />
              ) : (
                <CandidateAction live={live} hostName={iv.host.name} onAsk={join} />
              )}
            </div>

            {!over ? (
              <p className="mt-4 text-[12px] leading-relaxed text-faint">
                The room takes over your whole screen and you cannot navigate away until the
                interview is ended.
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function HostAction({
  live,
  pending,
  error,
  onGoLive,
  onJoin,
  onCancel,
}: {
  live: boolean;
  pending: boolean;
  error: unknown;
  onGoLive: () => void;
  onJoin: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-[13px] text-muted">
        {live
          ? 'The room is open. Your candidate waits in the lobby until you admit them.'
          : 'Starting the room opens it for your candidate — they will ask to join and you decide when to let them in.'}
      </p>
      <button
        type="button"
        disabled={pending}
        onClick={live ? onJoin : onGoLive}
        className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-danger-solid px-4 py-2.5 text-[13px] font-semibold text-white hover:opacity-90 disabled:opacity-50"
      >
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : live ? (
          <DoorOpen className="h-4 w-4" aria-hidden="true" />
        ) : (
          <Radio className="h-4 w-4" aria-hidden="true" />
        )}
        {live ? 'Join now' : 'Go live & join'}
      </button>
      {error ? (
        <p className="text-[12px] text-danger">
          {error instanceof ApiError ? error.message : 'Could not start the interview'}
        </p>
      ) : null}
      {!live ? (
        <button
          type="button"
          disabled={pending}
          onClick={onCancel}
          className="text-[13px] font-medium text-danger hover:underline disabled:opacity-50"
        >
          Cancel this interview
        </button>
      ) : null}
    </div>
  );
}

function CandidateAction({
  live,
  hostName,
  onAsk,
}: {
  live: boolean;
  hostName: string;
  onAsk: () => void;
}) {
  // Before the room exists there is nothing to knock on — but the candidate is
  // here, checked, and told exactly what happens next. The page is polling, so
  // the button appears by itself the moment the interviewer opens the room.
  if (!live) {
    return (
      <div className="space-y-3">
        <p className="inline-flex items-center gap-2 text-[13px] font-medium text-fg">
          <Loader2
            className="h-4 w-4 animate-spin text-muted motion-reduce:animate-none"
            aria-hidden="true"
          />
          Waiting for {hostName} to start the interview
        </p>
        <p className="text-[13px] leading-relaxed text-muted">
          You are early — that is fine. Check your camera and microphone while you wait; the join
          button appears here on its own as soon as the room opens.
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <p className="inline-flex items-center gap-2 text-[13px] text-muted">
        <Users className="h-4 w-4" aria-hidden="true" /> The room is open.
      </p>
      <button
        type="button"
        onClick={onAsk}
        className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-fg px-4 py-2.5 text-[13px] font-semibold text-bg hover:opacity-90"
      >
        <DoorOpen className="h-4 w-4" aria-hidden="true" /> Ask to join
      </button>
      <p className="text-[13px] leading-relaxed text-muted">
        {hostName} will be told you are waiting and will let you in.
      </p>
    </div>
  );
}

function Over({ iv }: { iv: InterviewDetail }) {
  return (
    <div className="space-y-3">
      <p className="text-[13px] text-muted">
        {iv.status === 'CANCELLED'
          ? 'This interview was cancelled.'
          : 'This interview has already ended.'}
      </p>
      <Link
        to="/app/interviews"
        className="inline-flex items-center gap-1.5 text-[13px] font-medium text-accent"
      >
        Back to interviews
      </Link>
    </div>
  );
}
