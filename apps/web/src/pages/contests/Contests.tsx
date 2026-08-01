import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Trophy, Plus, Users, ListChecks } from 'lucide-react';
import type { ContestListItem, ContestListResponse } from '@code-nexus/types';
import { api } from '../../lib/api.ts';
import { useAuth } from '../../lib/auth.tsx';
import { contestKeys, formatDateTime } from '../../lib/contests.ts';
import { AppShell } from '../../components/dashboard/AppShell.tsx';
import { Panel } from '../../components/dashboard/Panel.tsx';
import { EmptyState } from '../../components/dashboard/EmptyState.tsx';
import { QueryState } from '../../components/dashboard/QueryState.tsx';
import { ContestPhaseBadge, Countdown } from '../../components/contests/ContestBits.tsx';

export function Contests() {
  const { me } = useAuth();
  const isHost = me?.role === 'UNIVERSITY' || me?.role === 'COMPANY' || me?.role === 'ADMIN';
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: contestKeys.list,
    queryFn: () => api.get<ContestListResponse>('/contests'),
  });

  return (
    <AppShell title="Contests">
      <QueryState isLoading={isLoading} isError={isError} onRetry={() => refetch()}>
        <Panel
          title={isHost ? 'Your contests' : 'Contests'}
          action={
            isHost ? (
              <Link
                to="/app/contests/new"
                className="inline-flex items-center gap-1.5 rounded-lg bg-fg px-3 py-1.5 text-[13px] font-medium text-bg transition-opacity hover:opacity-90"
              >
                <Plus className="h-3.5 w-3.5" /> New contest
              </Link>
            ) : undefined
          }
        >
          {data && data.contests.length === 0 ? (
            <EmptyState
              icon={Trophy}
              title="No contests yet"
              hint={
                isHost
                  ? 'Schedule a timed contest for a university.'
                  : 'Contests at your university appear here.'
              }
            />
          ) : (
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {data?.contests.map((c) => (
                <ContestCard key={c.publicId} c={c} host={isHost} />
              ))}
            </ul>
          )}
        </Panel>
      </QueryState>
    </AppShell>
  );
}

function ContestCard({ c, host }: { c: ContestListItem; host: boolean }) {
  // A student mid-attempt (started, not submitted) jumps straight back in.
  const midAttempt = !host && c.startedAt && !c.submittedAt;
  const to = midAttempt ? `/app/contests/${c.publicId}/arena` : `/app/contests/${c.publicId}`;
  return (
    <li>
      <Link
        to={to}
        className="block rounded-xl border border-line bg-bg p-4 transition-colors hover:border-line-strong"
      >
        <div className="flex items-start justify-between gap-2">
          <p className="font-semibold tracking-tight text-fg">{c.title}</p>
          <ContestPhaseBadge phase={c.phase} />
        </div>
        <p className="mt-1 text-[12px] text-muted">
          {c.host.name} → {c.targetUniversity.name}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-[12px] text-faint">
          <span className="inline-flex items-center gap-1">
            <ListChecks className="h-3.5 w-3.5" /> {c.questionCount} Q
          </span>
          <span className="inline-flex items-center gap-1">
            <Users className="h-3.5 w-3.5" /> {c.participantCount}
          </span>
          {!host && c.submittedAt ? (
            <span className="text-success">Submitted</span>
          ) : c.phase === 'upcoming' ? (
            <span className="text-info">
              opens in <Countdown target={c.startsAt} />
            </span>
          ) : c.phase === 'open' ? (
            <span className="text-success">
              entry closes in <Countdown target={c.entryDeadline} />
            </span>
          ) : c.phase === 'running' ? (
            <span className="text-warn">in progress</span>
          ) : (
            <span>{formatDateTime(c.startsAt)}</span>
          )}
        </div>
      </Link>
    </li>
  );
}
