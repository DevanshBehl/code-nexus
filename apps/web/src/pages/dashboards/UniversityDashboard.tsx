import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Users, Briefcase, CheckCircle2, Search } from 'lucide-react';
import type { UniversityDashboard as UniData, StudentListRow } from '@code-nexus/types';
import { api } from '../../lib/api.ts';
import { AppShell } from '../../components/dashboard/AppShell.tsx';
import { Panel } from '../../components/dashboard/Panel.tsx';
import { Calendar } from '../../components/dashboard/Calendar.tsx';
import { EmptyState } from '../../components/dashboard/EmptyState.tsx';
import { QueryState } from '../../components/dashboard/QueryState.tsx';
import { StatRow, StatTile } from '../../components/dashboard/StatTile.tsx';
import { DataTable, type Column } from '../../components/dashboard/DataTable.tsx';
import { StatusBadge } from '../../components/dashboard/StatusBadge.tsx';

export function UniversityDashboard() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['dashboard', 'university'],
    queryFn: () => api.get<UniData>('/dashboard'),
  });
  const [q, setQ] = useState('');

  const filtered = useMemo(() => {
    const rows = data?.students ?? [];
    if (!q.trim()) return rows;
    const needle = q.toLowerCase();
    return rows.filter((s) =>
      [s.firstName, s.lastName, s.rollNumber, s.branch, s.email]
        .filter(Boolean)
        .some((v) => v!.toLowerCase().includes(needle)),
    );
  }, [data, q]);

  const columns: Column<StudentListRow>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (s) => [s.firstName, s.lastName].filter(Boolean).join(' ') || '—',
    },
    { key: 'roll', header: 'Roll no.', render: (s) => s.rollNumber ?? '—' },
    { key: 'branch', header: 'Branch', render: (s) => s.branch ?? '—' },
    { key: 'grad', header: 'Grad yr', render: (s) => s.graduationYear ?? '—' },
    { key: 'cgpa', header: 'CGPA', render: (s) => s.cgpa ?? '—' },
    { key: 'status', header: 'Status', render: (s) => <StatusBadge status={s.status} /> },
  ];

  return (
    <AppShell title="University Dashboard">
      <QueryState isLoading={isLoading} isError={isError} onRetry={() => refetch()}>
        {data ? (
          <div className="space-y-6">
            <StatRow>
              <StatTile label="Students" value={data.counts.students} icon={Users} />
              <StatTile label="Branches" value={data.counts.byBranch.length} icon={Users} />
              <StatTile label="Drives" value={data.drives.length} icon={Briefcase} />
              <StatTile label="Placed" value={data.placement.offered} icon={CheckCircle2} />
            </StatRow>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              <div className="space-y-6 lg:col-span-2">
                <Panel
                  title={`Students · ${data.university.name}`}
                  action={
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
                      <input
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        placeholder="Search students"
                        aria-label="Search students"
                        className="w-44 rounded-lg border border-line-strong bg-surface py-1.5 pl-8 pr-2 text-[13px] text-fg placeholder:text-faint focus:border-accent focus:outline-none"
                      />
                    </div>
                  }
                >
                  <DataTable
                    columns={columns}
                    rows={filtered}
                    rowKey={(s) => s.publicId}
                    empty={
                      <EmptyState
                        icon={Users}
                        title={q ? 'No matching students' : 'No students yet'}
                        hint={q ? undefined : 'Provisioned students appear here, sorted by branch.'}
                      />
                    }
                  />
                </Panel>

                <Panel
                  title="Placed / rejected tracking"
                  action={
                    <Link
                      to="/app/university/drives"
                      className="text-[13px] font-medium text-accent"
                    >
                      View all
                    </Link>
                  }
                >
                  {data.placement.applied +
                    data.placement.shortlisted +
                    data.placement.offered +
                    data.placement.rejected ===
                  0 ? (
                    <EmptyState
                      icon={CheckCircle2}
                      title="No placement data yet"
                      hint="Offers and rejections will be tracked here once your students apply to drives."
                    />
                  ) : (
                    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <Track label="Applied" value={data.placement.applied} />
                      <Track label="Shortlisted" value={data.placement.shortlisted} />
                      <Track label="Offered" value={data.placement.offered} />
                      <Track label="Rejected" value={data.placement.rejected} />
                    </dl>
                  )}
                </Panel>
              </div>

              <div className="space-y-6 lg:col-span-1">
                <Panel title="Students by branch">
                  {data.counts.byBranch.length === 0 ? (
                    <EmptyState icon={Users} title="No branches yet" />
                  ) : (
                    <ul className="space-y-2">
                      {data.counts.byBranch.map((b) => (
                        <li
                          key={b.branch}
                          className="flex items-center justify-between text-[13px]"
                        >
                          <span className="text-muted">{b.branch}</span>
                          <span className="font-medium text-fg">{b.count}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Panel>
                <Calendar />
              </div>
            </div>
          </div>
        ) : null}
      </QueryState>
    </AppShell>
  );
}

function Track({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-line bg-bg py-3 text-center">
      <dd className="text-xl font-semibold tracking-tight text-fg">{value}</dd>
      <dt className="mono-label mt-0.5 text-[9px] text-faint">{label}</dt>
    </div>
  );
}
