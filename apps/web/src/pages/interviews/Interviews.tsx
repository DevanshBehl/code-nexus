import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { DoorOpen, Plus, MonitorPlay } from 'lucide-react';
import type { InterviewListItem, InterviewListResponse } from '@code-nexus/types';
import { api } from '../../lib/api.ts';
import { useAuth } from '../../lib/auth.tsx';
import { interviewKeys, formatDateTime } from '../../lib/interviews.ts';
import { AppShell } from '../../components/dashboard/AppShell.tsx';
import { Panel } from '../../components/dashboard/Panel.tsx';
import { QueryState } from '../../components/dashboard/QueryState.tsx';
import { InterviewStatusBadge } from '../../components/interviews/InterviewBits.tsx';

export function Interviews() {
  const { me } = useAuth();
  const isHost = me?.role === 'COMPANY' || me?.role === 'UNIVERSITY' || me?.role === 'ADMIN';

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: interviewKeys.list,
    queryFn: () => api.get<InterviewListResponse>('/interviews'),
    // A candidate watching this list should see "Join" light up when their
    // interviewer opens the room, without being told to refresh.
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });

  return (
    <AppShell title="Interviews">
      <Panel
        title={isHost ? 'Your interviews' : 'My interviews'}
        action={
          isHost ? (
            <Link
              to="/app/interviews/new"
              className="inline-flex items-center gap-1.5 rounded-lg bg-fg px-3 py-1.5 text-[13px] font-medium text-bg hover:opacity-90"
            >
              <Plus className="h-3.5 w-3.5" /> Schedule
            </Link>
          ) : undefined
        }
      >
        <QueryState isLoading={isLoading} isError={isError} onRetry={() => refetch()}>
          {data && data.interviews.length > 0 ? (
            <ul className="divide-y divide-line">
              {data.interviews.map((i) => (
                <InterviewRow key={i.publicId} i={i} />
              ))}
            </ul>
          ) : (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <MonitorPlay className="h-6 w-6 text-faint" aria-hidden="true" />
              <p className="text-[13px] text-muted">
                {isHost
                  ? 'No interviews yet. Schedule one with a candidate.'
                  : 'No interviews scheduled for you yet.'}
              </p>
            </div>
          )}
        </QueryState>
      </Panel>
    </AppShell>
  );
}

function InterviewRow({ i }: { i: InterviewListItem }) {
  // Every interview that has not finished has a way in — for the candidate too,
  // not just the host. A scheduled one opens the lobby, where you can check your
  // camera and wait for the room; the button is never absent with no explanation.
  const open = i.status === 'SCHEDULED' || i.status === 'LIVE';
  return (
    <li>
      <Link
        to={`/app/interviews/${i.publicId}`}
        className="flex items-center justify-between gap-3 py-3 transition-colors hover:text-accent"
      >
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-fg">{i.title ?? 'Interview'}</p>
          <p className="mt-0.5 text-[12px] text-muted">
            {i.canManage ? i.candidate.displayName : i.host.name} ·{' '}
            {formatDateTime(i.scheduledStartsAt)} · {i.durationMinutes} min
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2.5">
          <InterviewStatusBadge status={i.status} />
          {open ? (
            <span
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold ${
                i.status === 'LIVE' ? 'bg-danger-solid text-white' : 'border border-line-strong text-fg'
              }`}
            >
              <DoorOpen className="h-3.5 w-3.5" aria-hidden="true" />
              {i.status === 'LIVE' ? 'Join' : 'Lobby'}
            </span>
          ) : null}
        </div>
      </Link>
    </li>
  );
}
