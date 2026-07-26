import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText } from 'lucide-react';
import {
  canStudentWithdraw,
  type ApplicationsResponse,
  type MyApplicationRow,
} from '@code-nexus/types';
import { api, ApiError } from '../../lib/api.ts';
import { driveKeys, formatDate } from '../../lib/drives.ts';
import { AppShell } from '../../components/dashboard/AppShell.tsx';
import { Panel } from '../../components/dashboard/Panel.tsx';
import { EmptyState } from '../../components/dashboard/EmptyState.tsx';
import { QueryState } from '../../components/dashboard/QueryState.tsx';
import { DataTable, type Column } from '../../components/dashboard/DataTable.tsx';
import { ApplicationStatusBadge } from '../../components/drives/DriveBadges.tsx';

export function MyApplications() {
  const qc = useQueryClient();
  const [error, setError] = useState<string>();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: driveKeys.myApplications,
    queryFn: () => api.get<ApplicationsResponse>('/applications'),
  });

  const withdraw = useMutation({
    mutationFn: (publicId: string) => api.post(`/applications/${publicId}/withdraw`),
    onSuccess: () => {
      setError(undefined);
      void qc.invalidateQueries({ queryKey: driveKeys.myApplications });
      void qc.invalidateQueries({ queryKey: driveKeys.list });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not withdraw'),
  });

  const columns: Column<MyApplicationRow>[] = [
    {
      key: 'drive',
      header: 'Drive',
      render: (a) => (
        <Link
          to={`/app/student/drives/${a.drive.publicId}`}
          className="font-medium text-fg hover:text-accent"
        >
          {a.drive.title}
        </Link>
      ),
    },
    { key: 'company', header: 'Company', render: (a) => a.drive.company.name },
    { key: 'applied', header: 'Applied', render: (a) => formatDate(a.appliedAt) },
    {
      key: 'status',
      header: 'Status',
      render: (a) => <ApplicationStatusBadge status={a.status} />,
    },
    {
      key: 'actions',
      header: '',
      render: (a) =>
        canStudentWithdraw(a.status) ? (
          <button
            type="button"
            disabled={withdraw.isPending}
            onClick={() => withdraw.mutate(a.publicId)}
            className="rounded-md border border-line-strong px-2 py-1 text-[11px] font-medium text-fg hover:bg-surface-2 disabled:opacity-50"
          >
            Withdraw
          </button>
        ) : null,
    },
  ];

  return (
    <AppShell title="My applications">
      <QueryState isLoading={isLoading} isError={isError} onRetry={() => refetch()}>
        {data ? (
          <Panel title="Your applications">
            {error ? (
              <p className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[13px] text-red-500">
                {error}
              </p>
            ) : null}
            <DataTable
              columns={columns}
              rows={data.applications}
              rowKey={(a) => a.publicId}
              empty={
                <EmptyState
                  icon={FileText}
                  title="No applications yet"
                  hint="Apply to an open drive and track its progress here."
                />
              }
            />
          </Panel>
        ) : null}
      </QueryState>
    </AppShell>
  );
}
