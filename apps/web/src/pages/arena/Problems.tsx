import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Code2, CheckCircle2, Circle, CircleDot, Search } from 'lucide-react';
import {
  DIFFICULTIES,
  TOPICS,
  type ArenaStats,
  type Difficulty,
  type QuestionListItem,
  type QuestionListResponse,
  type Topic,
} from '@code-nexus/types';
import { api } from '../../lib/api.ts';
import { arenaKeys, titleCase } from '../../lib/arena.ts';
import { AppShell } from '../../components/dashboard/AppShell.tsx';
import { Panel } from '../../components/dashboard/Panel.tsx';
import { EmptyState } from '../../components/dashboard/EmptyState.tsx';
import { QueryState } from '../../components/dashboard/QueryState.tsx';
import { DifficultyBadge } from '../../components/arena/DifficultyBadge.tsx';

const inputCls =
  'rounded-lg border border-line-strong bg-surface px-2 py-1.5 text-[12px] text-fg focus:border-accent focus:outline-none';

type StatusFilter = '' | QuestionListItem['status'];

/**
 * The problem list. Sorted by the platform, filtered by the student, and read
 * top to bottom — so the row is the unit of design: where you are with a problem
 * (the status mark), what it is, and what it will cost you (the difficulty).
 */
export function Problems() {
  const [topic, setTopic] = useState<'' | Topic>('');
  const [difficulty, setDifficulty] = useState<'' | Difficulty>('');
  const [status, setStatus] = useState<StatusFilter>('');
  const [q, setQ] = useState('');

  const params = useMemo(() => {
    const p = new URLSearchParams();
    if (topic) p.set('topic', topic);
    if (difficulty) p.set('difficulty', difficulty);
    if (q.trim()) p.set('q', q.trim());
    return p.toString();
  }, [topic, difficulty, q]);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: arenaKeys.questions(params),
    queryFn: () => api.get<QuestionListResponse>(`/arena/questions?${params}`),
  });
  // Solved counts come from the server rather than from the rows on screen, so a
  // filter never makes it look like progress was lost.
  const stats = useQuery({
    queryKey: arenaKeys.stats,
    queryFn: () => api.get<ArenaStats>('/arena/stats'),
  });

  // Status is the one filter the list endpoint does not take — it is per-student
  // state, not a property of the question — so it is applied here.
  const items = (data?.items ?? []).filter((r) => !status || r.status === status);

  return (
    <AppShell title="Code Arena">
      <QueryState isLoading={isLoading} isError={isError} onRetry={() => refetch()}>
        <div className="space-y-4">
          <SolvedSummary stats={stats.data} />

          <Panel
            title="Problems"
            action={
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Search"
                    aria-label="Search problems"
                    className={`${inputCls} w-36 pl-7`}
                  />
                </div>
                <select
                  aria-label="Filter by status"
                  value={status}
                  onChange={(e) => setStatus(e.target.value as StatusFilter)}
                  className={inputCls}
                >
                  <option value="">Any status</option>
                  <option value="unsolved">Todo</option>
                  <option value="attempted">Attempted</option>
                  <option value="solved">Solved</option>
                </select>
                <select
                  aria-label="Filter by topic"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value as Topic | '')}
                  className={inputCls}
                >
                  <option value="">All topics</option>
                  {TOPICS.map((t) => (
                    <option key={t} value={t}>
                      {titleCase(t)}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Filter by difficulty"
                  value={difficulty}
                  onChange={(e) => setDifficulty(e.target.value as Difficulty | '')}
                  className={inputCls}
                >
                  <option value="">All levels</option>
                  {DIFFICULTIES.map((d) => (
                    <option key={d} value={d}>
                      {titleCase(d)}
                    </option>
                  ))}
                </select>
              </div>
            }
          >
            {items.length === 0 ? (
              <EmptyState icon={Code2} title="No problems found" />
            ) : (
              <ul className="divide-y divide-line">
                {items.map((r) => (
                  <ProblemRow key={r.slug} row={r} />
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </QueryState>
    </AppShell>
  );
}

function ProblemRow({ row }: { row: QuestionListItem }) {
  return (
    <li>
      <Link
        to={`/app/arena/${row.slug}`}
        className="group flex items-center gap-3 px-1 py-2.5 transition-colors hover:bg-surface-2"
      >
        <StatusMark status={row.status} />
        <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-fg group-hover:text-accent">
          {row.title}
        </span>
        <span className="mono-label hidden shrink-0 rounded-full border border-line px-2 py-0.5 text-[9px] text-faint sm:inline-block">
          {titleCase(row.topic)}
        </span>
        <span className="shrink-0">
          <DifficultyBadge difficulty={row.difficulty} />
        </span>
      </Link>
    </li>
  );
}

function StatusMark({ status }: { status: QuestionListItem['status'] }) {
  if (status === 'solved') {
    return (
      <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-label="Solved" role="img" />
    );
  }
  if (status === 'attempted') {
    return <CircleDot className="h-4 w-4 shrink-0 text-warn" aria-label="Attempted" role="img" />;
  }
  return <Circle className="h-4 w-4 shrink-0 text-faint" aria-label="Not started" role="img" />;
}

/** Solved-by-difficulty, the only progress number a practice bank owes anyone. */
function SolvedSummary({ stats }: { stats?: ArenaStats }) {
  if (!stats) return null;
  const cells: { label: string; solved: number; tone: string }[] = [
    { label: 'Easy', solved: stats.solved.easy, tone: 'text-success' },
    { label: 'Medium', solved: stats.solved.medium, tone: 'text-warn' },
    { label: 'Hard', solved: stats.solved.hard, tone: 'text-danger' },
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-line bg-surface px-4 py-3">
      <div>
        <p className="text-[19px] font-semibold tabular-nums text-fg">{stats.solved.total}</p>
        <p className="mono-label text-[9px] text-faint">Solved</p>
      </div>
      <div className="h-8 w-px bg-line" />
      {cells.map((c) => (
        <div key={c.label}>
          <p className={`text-[15px] font-semibold tabular-nums ${c.tone}`}>{c.solved}</p>
          <p className="mono-label text-[9px] text-faint">{c.label}</p>
        </div>
      ))}
      {stats.attempted > 0 ? (
        <div className="ml-auto text-[12px] text-muted">
          <span className="tabular-nums">{stats.attempted}</span> attempted but not solved
        </div>
      ) : null}
    </div>
  );
}
