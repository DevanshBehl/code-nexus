import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Code2, CheckCircle2, Circle, CircleDot, Search } from 'lucide-react';
import {
  DIFFICULTIES,
  TOPICS,
  type Difficulty,
  type QuestionListItem,
  type QuestionListResponse,
  type Topic,
} from '@code-nexus/types';
import { api } from '../../lib/api.ts';
import { arenaKeys } from '../../lib/arena.ts';
import { AppShell } from '../../components/dashboard/AppShell.tsx';
import { Panel } from '../../components/dashboard/Panel.tsx';
import { EmptyState } from '../../components/dashboard/EmptyState.tsx';
import { QueryState } from '../../components/dashboard/QueryState.tsx';
import { DataTable, type Column } from '../../components/dashboard/DataTable.tsx';
import { DifficultyBadge } from '../../components/arena/DifficultyBadge.tsx';

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const inputCls =
  'rounded-lg border border-line-strong bg-surface px-2 py-1.5 text-[12px] text-fg focus:border-accent focus:outline-none';

export function Problems() {
  const [topic, setTopic] = useState<'' | Topic>('');
  const [difficulty, setDifficulty] = useState<'' | Difficulty>('');
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

  const statusIcon = (s: QuestionListItem['status']) => {
    if (s === 'solved') return <CheckCircle2 className="h-4 w-4 text-success" />;
    if (s === 'attempted') return <CircleDot className="h-4 w-4 text-warn" />;
    return <Circle className="h-4 w-4 text-faint" />;
  };

  const columns: Column<QuestionListItem>[] = [
    { key: 'status', header: '', render: (r) => statusIcon(r.status), className: 'w-8' },
    {
      key: 'title',
      header: 'Problem',
      render: (r) => (
        <Link to={`/app/arena/${r.slug}`} className="font-medium text-fg hover:text-accent">
          {r.title}
        </Link>
      ),
    },
    { key: 'topic', header: 'Topic', render: (r) => titleCase(r.topic) },
    {
      key: 'difficulty',
      header: 'Difficulty',
      render: (r) => <DifficultyBadge difficulty={r.difficulty} />,
    },
  ];

  return (
    <AppShell title="Code Arena">
      <QueryState isLoading={isLoading} isError={isError} onRetry={() => refetch()}>
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
          <DataTable
            columns={columns}
            rows={data?.items ?? []}
            rowKey={(r) => r.slug}
            empty={<EmptyState icon={Code2} title="No problems found" />}
          />
        </Panel>
      </QueryState>
    </AppShell>
  );
}
