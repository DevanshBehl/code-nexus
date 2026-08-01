import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import type { InterviewDetail } from '@code-nexus/types';
import { api, ApiError } from '../../lib/api.ts';
import { interviewKeys } from '../../lib/interviews.ts';
import { AppShell } from '../../components/dashboard/AppShell.tsx';
import { Panel } from '../../components/dashboard/Panel.tsx';
import { QueryState } from '../../components/dashboard/QueryState.tsx';
import {
  FeedbackForm,
  FeedbackList,
  InterviewStatusBadge,
} from '../../components/interviews/InterviewBits.tsx';
import { Lobby } from './Lobby.tsx';
import { MeetRoom } from './MeetRoom.tsx';

/** What the joiner brought with them from the lobby. */
interface JoinedMedia {
  stream: MediaStream | null;
  micOn: boolean;
  camOn: boolean;
}

/**
 * The interview page has three shapes, and which one you get is not decided by
 * role but by where you are in the journey:
 *
 *  1. LOBBY   — device check + the door. Both sides start here, at any status,
 *               which is what lets a candidate turn up early instead of finding
 *               a page with nothing on it.
 *  2. ROOM    — joined (or knocking); full-viewport and locked.
 *  3. RECAP   — the interview is over: snapshot, feedback, next steps.
 */
export function InterviewRoom() {
  const { publicId = '' } = useParams();
  const qc = useQueryClient();
  const [joined, setJoined] = useState<JoinedMedia | null>(null);

  const detail = useQuery({
    queryKey: interviewKeys.detail(publicId),
    queryFn: () => api.get<InterviewDetail>(`/interviews/${publicId}`),
    // While a candidate waits in the lobby for the room to open, this poll IS the
    // feature — it is what makes the join button appear without a refresh.
    refetchInterval: (q) => (q.state.data?.status === 'SCHEDULED' ? 5_000 : false),
  });
  const iv = detail.data;
  const invalidate = (): Promise<void> =>
    qc.invalidateQueries({ queryKey: interviewKeys.detail(publicId) });

  // The page owns the camera once the lobby hands it over, so it is the only
  // place that can reliably switch it off again — including on unmount, which is
  // where a stream created inside the room itself would leak.
  const joinedRef = useRef<JoinedMedia | null>(null);
  joinedRef.current = joined;
  useEffect(
    () => () => {
      joinedRef.current?.stream?.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  /** Leaving the room drops the devices; the lobby acquires them fresh. */
  const backToLobby = useCallback((): void => {
    setJoined((cur) => {
      cur?.stream?.getTracks().forEach((t) => t.stop());
      return null;
    });
  }, []);

  if (iv && joined) {
    return (
      <MeetRoom
        iv={iv}
        publicId={publicId}
        stream={joined.stream}
        initialMic={joined.micOn}
        initialCam={joined.camOn}
        onEnded={() => void invalidate()}
        onLeave={backToLobby}
      />
    );
  }

  // Over and done with — the recap belongs in the app, not behind a lobby.
  if (iv && (iv.status === 'ENDED' || iv.status === 'CANCELLED')) {
    return (
      <AppShell title={iv.title ?? 'Interview'} fullBleed>
        <div className="mx-auto w-full max-w-6xl px-4 py-4">
          <Link
            to="/app/interviews"
            className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-fg"
          >
            <ArrowLeft className="h-4 w-4" /> Interviews
          </Link>
          <Recap iv={iv} publicId={publicId} />
        </div>
      </AppShell>
    );
  }

  if (iv) {
    return (
      <Lobby
        iv={iv}
        publicId={publicId}
        onJoin={(stream, micOn, camOn) => setJoined({ stream, micOn, camOn })}
        onWentLive={() => void invalidate()}
      />
    );
  }

  return (
    <AppShell title="Interview" fullBleed>
      <div className="mx-auto w-full max-w-6xl px-4 py-4">
        <QueryState
          isLoading={detail.isLoading}
          isError={detail.isError}
          onRetry={() => detail.refetch()}
        >
          {null}
        </QueryState>
      </div>
    </AppShell>
  );
}

function Recap({ iv, publicId }: { iv: InterviewDetail; publicId: string }) {
  const qc = useQueryClient();
  const submit = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.post(`/interviews/${publicId}/feedback`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: interviewKeys.detail(publicId) }),
    onError: (e) => alert(e instanceof ApiError ? e.message : 'Could not submit feedback'),
  });

  return (
    <div className="space-y-4">
      <Panel title={iv.title ?? 'Interview'} action={<InterviewStatusBadge status={iv.status} />}>
        <p className="text-[13px] text-muted">
          {iv.status === 'CANCELLED'
            ? 'This interview was cancelled.'
            : 'This interview has ended.'}{' '}
          Candidate: <strong className="text-fg">{iv.candidate.displayName}</strong>.
        </p>
        {iv.codeSnapshot ? (
          <div className="mt-4">
            <h3 className="mono-label mb-1 text-[10px] text-faint">Final shared code</h3>
            <pre className="max-h-64 overflow-auto rounded-lg border border-line bg-surface-2 p-3 font-mono text-[12px] text-fg">
              {iv.codeSnapshot}
            </pre>
          </div>
        ) : null}
      </Panel>

      {iv.canManage ? (
        <>
          <Panel title="Submit feedback (private)">
            <FeedbackForm
              canAdvance
              pending={submit.isPending}
              onSubmit={(v) => submit.mutate(v)}
            />
          </Panel>
          <Panel title="Feedback">
            <FeedbackList feedback={iv.feedback ?? []} />
          </Panel>
        </>
      ) : (
        <Panel title="Thanks for attending">
          <p className="text-[13px] text-muted">
            Your interviewer will share next steps through your application.
          </p>
        </Panel>
      )}
    </div>
  );
}
