import { useQuery } from '@tanstack/react-query';
import { Briefcase, CheckCircle2, XCircle, Clock, Send } from 'lucide-react';
import type {
  DriveListResponse,
  DriveListRow,
  UniversityApplicationsResponse,
  UniversityApplicationRow,
} from '@code-nexus/types';
import { api } from '../../lib/api.ts';
import { driveKeys, formatDeadline, formatDate } from '../../lib/drives.ts';
import { AppShell } from '../../components/dashboard/AppShell.tsx';
import { Panel } from '../../components/dashboard/Panel.tsx';
import { EmptyState } from '../../components/dashboard/EmptyState.tsx';
import { QueryState } from '../../components/dashboard/QueryState.tsx';
import { StatRow, StatTile } from '../../components/dashboard/StatTile.tsx';
import { DataTable, type Column } from '../../components/dashboard/DataTable.tsx';
import { DriveStatusBadge, ApplicationStatusBadge } from '../../components/drives/DriveBadges.tsx';

export function UniversityDrives() {
  const drivesQuery = useQuery({
    queryKey: driveKeys.list,
    queryFn: () => api.get<DriveListResponse>('/drives'),
  });
  const appsQuery = useQuery({
    queryKey: driveKeys.universityApplications,
    queryFn: () => api.get<UniversityApplicationsResponse>('/applications'),
  });

  const apps = appsQuery.data?.applications ?? [];
  const count = (s: string) => apps.filter((a) => a.status === s).length;

  const driveCols: Column<DriveListRow>[] = [
    { key: 'title', header: 'Drive', render: (d) => d.title },
    { key: 'company', header: 'Company', render: (d) => d.company.name },
    { key: 'status', header: 'Status', render: (d) => <DriveStatusBadge status={d.status} /> },
    { key: 'deadline', header: 'Deadline', render: (d) => formatDeadline(d.applyDeadline) },
    { key: 'applicants', header: 'Applicants', render: (d) => d.applicantCount ?? 0 },
  ];

  const appCols: Column<UniversityApplicationRow>[] = [
    {
      key: 'student',
      header: 'Student',
      render: (a) => [a.student.firstName, a.student.lastName].filter(Boolean).join(' ') || '—',
    },
    { key: 'roll', header: 'Roll no.', render: (a) => a.student.rollNumber ?? '—' },
    { key: 'branch', header: 'Branch', render: (a) => a.student.branch ?? '—' },
    { key: 'drive', header: 'Drive', render: (a) => a.drive.title },
    { key: 'company', header: 'Company', render: (a) => a.drive.company.name },
    { key: 'applied', header: 'Applied', render: (a) => formatDate(a.appliedAt) },
    {
      key: 'status',
      header: 'Status',
      render: (a) => <ApplicationStatusBadge status={a.status} />,
    },
  ];

  return (
    <AppShell title="Drives & placements">
      <QueryState
        isLoading={drivesQuery.isLoading || appsQuery.isLoading}
        isError={drivesQuery.isError || appsQuery.isError}
        onRetry={() => {
          void drivesQuery.refetch();
          void appsQuery.refetch();
        }}
      >
        <div className="space-y-6">
          <StatRow>
            <StatTile label="Offered" value={count('OFFERED')} icon={CheckCircle2} />
            <StatTile label="Shortlisted" value={count('SHORTLISTED')} icon={Send} />
            <StatTile label="Applied" value={count('APPLIED')} icon={Clock} />
            <StatTile label="Rejected" value={count('REJECTED')} icon={XCircle} />
          </StatRow>

          <Panel title="Company drives targeting your university">
            <DataTable
              columns={driveCols}
              rows={drivesQuery.data?.drives ?? []}
              rowKey={(d) => d.publicId}
              empty={
                <EmptyState
                  icon={Briefcase}
                  title="No drives yet"
                  hint="Drives that companies launch with your university appear here."
                />
              }
            />
          </Panel>

          <Panel title="Placement tracking — your students' applications">
            <DataTable
              columns={appCols}
              rows={apps}
              rowKey={(a) => a.publicId}
              empty={
                <EmptyState
                  icon={CheckCircle2}
                  title="No applications yet"
                  hint="Once your students apply to drives, their outcomes are tracked here."
                />
              }
            />
          </Panel>
        </div>
      </QueryState>
    </AppShell>
  );
}
