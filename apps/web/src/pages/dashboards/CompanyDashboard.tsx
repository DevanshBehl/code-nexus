import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Users, Briefcase, Video, UserCheck, Plus } from 'lucide-react';
import type {
  CompanyDashboard as CompanyData,
  DriveListRow,
  RecruiterListRow,
} from '@code-nexus/types';
import { api } from '../../lib/api.ts';
import { formatDeadline } from '../../lib/drives.ts';
import { AppShell } from '../../components/dashboard/AppShell.tsx';
import { Panel } from '../../components/dashboard/Panel.tsx';
import { Calendar } from '../../components/dashboard/Calendar.tsx';
import { EmptyState } from '../../components/dashboard/EmptyState.tsx';
import { QueryState } from '../../components/dashboard/QueryState.tsx';
import { StatRow, StatTile } from '../../components/dashboard/StatTile.tsx';
import { DataTable, type Column } from '../../components/dashboard/DataTable.tsx';
import { StatusBadge } from '../../components/dashboard/StatusBadge.tsx';
import { DriveStatusBadge } from '../../components/drives/DriveBadges.tsx';

export function CompanyDashboard() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['dashboard', 'company'],
    queryFn: () => api.get<CompanyData>('/dashboard'),
  });

  const columns: Column<RecruiterListRow>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (r) => [r.firstName, r.lastName].filter(Boolean).join(' ') || '—',
    },
    { key: 'designation', header: 'Designation', render: (r) => r.designation ?? '—' },
    { key: 'email', header: 'Email', render: (r) => r.email },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
  ];

  const driveColumns: Column<DriveListRow>[] = [
    {
      key: 'title',
      header: 'Drive',
      render: (d) => (
        <Link
          to={`/app/company/drives/${d.publicId}`}
          className="font-medium text-fg hover:text-accent"
        >
          {d.title}
        </Link>
      ),
    },
    { key: 'university', header: 'University', render: (d) => d.university.name },
    { key: 'status', header: 'Status', render: (d) => <DriveStatusBadge status={d.status} /> },
    { key: 'deadline', header: 'Deadline', render: (d) => formatDeadline(d.applyDeadline) },
    { key: 'applicants', header: 'Applicants', render: (d) => d.applicantCount ?? 0 },
  ];

  return (
    <AppShell title="Company Dashboard">
      <QueryState isLoading={isLoading} isError={isError} onRetry={() => refetch()}>
        {data ? (
          <div className="space-y-6">
            <StatRow>
              <StatTile label="Recruiters" value={data.counts.recruiters} icon={Users} />
              <StatTile label="Open drives" value={data.counts.openDrives} icon={Briefcase} />
              <StatTile label="Applicants" value={data.counts.applicants} icon={UserCheck} />
              <StatTile label="Interviews" value={0} icon={Video} />
            </StatRow>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              <div className="space-y-6 lg:col-span-2">
                <Panel title={`Recruiters · ${data.company.name}`}>
                  <DataTable
                    columns={columns}
                    rows={data.recruiters}
                    rowKey={(r) => r.publicId}
                    empty={
                      <EmptyState
                        icon={Users}
                        title="No recruiters yet"
                        hint="Recruiters you provision appear here."
                      />
                    }
                  />
                </Panel>
                <Panel
                  title="Your drives"
                  action={
                    <Link
                      to="/app/company/drives/new"
                      className="inline-flex items-center gap-1.5 rounded-lg bg-fg px-3 py-1.5 text-[13px] font-medium text-bg transition-opacity hover:opacity-90"
                    >
                      <Plus className="h-3.5 w-3.5" /> New drive
                    </Link>
                  }
                >
                  <DataTable
                    columns={driveColumns}
                    rows={data.drives}
                    rowKey={(d) => d.publicId}
                    empty={
                      <EmptyState
                        icon={Briefcase}
                        title="No drives yet"
                        hint="Launch placement drives with universities."
                      />
                    }
                  />
                </Panel>
              </div>
              <div className="lg:col-span-1">
                <Calendar />
              </div>
            </div>
          </div>
        ) : null}
      </QueryState>
    </AppShell>
  );
}
