import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Radio } from 'lucide-react';
import type { InterviewDetail } from '@code-nexus/types';
import { api, ApiError } from '../../lib/api.ts';
import { interviewKeys, formatDateTime } from '../../lib/interviews.ts';
import { AppShell } from '../../components/dashboard/AppShell.tsx';
import { Panel } from '../../components/dashboard/Panel.tsx';
import { QueryState } from '../../components/dashboard/QueryState.tsx';
import {
  FeedbackForm,
  FeedbackList,
  InterviewStatusBadge,
} from '../../components/interviews/InterviewBits.tsx';
import { MeetRoom } from './MeetRoom.tsx';

export function InterviewRoom() {
  const { publicId = '' } = useParams();
  const qc = useQueryClient();
  const detail = useQuery({
    queryKey: interviewKeys.detail(publicId),
    queryFn: () => api.get<InterviewDetail>(`/interviews/${publicId}`),
  });
  const iv = detail.data;

  // A live interview takes over the whole viewport: no app shell, no sidebar, no
  // way to drift into the rest of the platform until the call is over.
  if (iv?.status === 'LIVE') {
    return (
      <MeetRoom
        iv={iv}
        publicId={publicId}
        onEnded={() => qc.invalidateQueries({ queryKey: interviewKeys.detail(publicId) })}
      />
    );
  }

  return (
    <AppShell title={iv?.title ?? 'Interview'} fullBleed>
      <div className="mx-auto w-full max-w-6xl px-4 py-4">
        <Link
          to="/app/interviews"
          className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-fg"
        >
          <ArrowLeft className="h-4 w-4" /> Interviews
        </Link>
        <QueryState
          isLoading={detail.isLoading}
          isError={detail.isError}
          onRetry={() => detail.refetch()}
        >
          {iv ? <RoomBody iv={iv} publicId={publicId} /> : null}
        </QueryState>
      </div>
    </AppShell>
  );
}

function RoomBody({ iv, publicId }: { iv: InterviewDetail; publicId: string }) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: interviewKeys.detail(publicId) });

  const lifecycle = useMutation({
    mutationFn: (action: 'go-live' | 'cancel') => api.post(`/interviews/${publicId}/${action}`),
    onSuccess: invalidate,
  });

  if (iv.status === 'SCHEDULED') {
    return (
      <Panel title={iv.title ?? 'Interview'} action={<InterviewStatusBadge status={iv.status} />}>
        <p className="text-[13px] text-muted">
          Scheduled for {formatDateTime(iv.scheduledStartsAt)} · {iv.durationMinutes} min ·{' '}
          candidate <strong className="text-fg">{iv.candidate.displayName}</strong>.
        </p>
        {iv.question ? (
          <p className="mt-2 text-[13px] text-muted">
            Coding problem: <strong className="text-fg">{iv.question.title}</strong>
          </p>
        ) : null}
        <div className="mt-5 flex items-center gap-3 border-t border-line pt-5">
          {iv.canManage ? (
            <button
              type="button"
              disabled={lifecycle.isPending}
              onClick={() => lifecycle.mutate('go-live')}
              className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3.5 py-2 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              <Radio className="h-4 w-4" /> Go live
            </button>
          ) : (
            <p className="text-[13px] text-muted">Waiting for the interviewer to start the room…</p>
          )}
          {iv.canManage ? (
            <button
              type="button"
              onClick={() => lifecycle.mutate('cancel')}
              className="text-[13px] font-medium text-red-500 hover:underline"
            >
              Cancel
            </button>
          ) : null}
        </div>
      </Panel>
    );
  }

  // LIVE is intercepted upstream by the full-screen MeetRoom, so anything that
  // reaches here is over (or was cancelled).
  return <Recap iv={iv} publicId={publicId} />;
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
