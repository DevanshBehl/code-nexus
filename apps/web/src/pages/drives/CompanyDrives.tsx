import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Briefcase, Plus } from 'lucide-react';
import type { DriveListResponse, DriveListRow } from '@code-nexus/types';
import { api } from '../../lib/api.ts';
import { driveKeys, formatDeadline } from '../../lib/drives.ts';
import { AppShell } from '../../components/dashboard/AppShell.tsx';
import { Panel } from '../../components/dashboard/Panel.tsx';
import { EmptyState } from '../../components/dashboard/EmptyState.tsx';
import { QueryState } from '../../components/dashboard/QueryState.tsx';
import { DataTable, type Column } from '../../components/dashboard/DataTable.tsx';
import { DriveStatusBadge } from '../../components/drives/DriveBadges.tsx';

export function CompanyDrives() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: driveKeys.list,
    queryFn: () => api.get<DriveListResponse>('/drives'),
  });

  const columns: Column<DriveListRow>[] = [
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
    <AppShell title="Drives">
      <QueryState isLoading={isLoading} isError={isError} onRetry={() => refetch()}>
        {data ? (
          <Panel
            title="Your placement drives"
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
              columns={columns}
              rows={data.drives}
              rowKey={(d) => d.publicId}
              empty={
                <EmptyState
                  icon={Briefcase}
                  title="No drives yet"
                  hint="Launch a placement drive with a university to start receiving applicants."
                />
              }
            />
          </Panel>
        ) : null}
      </QueryState>
    </AppShell>
  );
}
