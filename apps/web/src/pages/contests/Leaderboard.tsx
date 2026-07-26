import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import type { ContestDetail, LeaderboardResponse } from '@code-nexus/types';
import { api } from '../../lib/api.ts';
import { contestKeys } from '../../lib/contests.ts';
import { AppShell } from '../../components/dashboard/AppShell.tsx';
import { Panel } from '../../components/dashboard/Panel.tsx';
import { QueryState } from '../../components/dashboard/QueryState.tsx';
import { ContestPhaseBadge, LeaderboardTable } from '../../components/contests/ContestBits.tsx';

export function Leaderboard() {
  const { publicId = '' } = useParams();

  const contest = useQuery({
    queryKey: contestKeys.detail(publicId),
    queryFn: () => api.get<ContestDetail>(`/contests/${publicId}`),
  });

  const lb = useQuery({
    queryKey: contestKeys.leaderboard(publicId),
    queryFn: () => api.get<LeaderboardResponse>(`/contests/${publicId}/leaderboard`),
    // Poll while attempts are in progress; stop once the contest has ended.
    refetchInterval: () => {
      const p = contest.data?.phase;
      return p === 'open' || p === 'running' ? 5000 : false;
    },
  });

  const questionSlugs =
    contest.data?.questions?.map((q) => q.slug) ??
    lb.data?.entries[0]?.perQuestion.map((p) => p.slug) ??
    [];

  return (
    <AppShell title="Leaderboard">
      <Link
        to={`/app/contests/${publicId}`}
        className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-fg"
      >
        <ArrowLeft className="h-4 w-4" /> Back to contest
      </Link>
      <QueryState isLoading={lb.isLoading} isError={lb.isError} onRetry={() => lb.refetch()}>
        {lb.data ? (
          <Panel
            title={`${lb.data.contest.title} · Leaderboard`}
            action={<ContestPhaseBadge phase={lb.data.contest.phase} />}
          >
            <LeaderboardTable entries={lb.data.entries} questionSlugs={questionSlugs} />
          </Panel>
        ) : null}
      </QueryState>
    </AppShell>
  );
}
