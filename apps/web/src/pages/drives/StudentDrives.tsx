import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Briefcase, MapPin, CalendarClock } from 'lucide-react';
import type { DriveListResponse } from '@code-nexus/types';
import { api } from '../../lib/api.ts';
import { driveKeys, formatDeadline } from '../../lib/drives.ts';
import { AppShell } from '../../components/dashboard/AppShell.tsx';
import { Panel } from '../../components/dashboard/Panel.tsx';
import { EmptyState } from '../../components/dashboard/EmptyState.tsx';
import { QueryState } from '../../components/dashboard/QueryState.tsx';
import { ApplicationStatusBadge } from '../../components/drives/DriveBadges.tsx';

export function StudentDrives() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: driveKeys.list,
    queryFn: () => api.get<DriveListResponse>('/drives'),
  });

  return (
    <AppShell title="Placement drives">
      <QueryState isLoading={isLoading} isError={isError} onRetry={() => refetch()}>
        {data ? (
          <Panel title="Open drives you're eligible for">
            {data.drives.length === 0 ? (
              <EmptyState
                icon={Briefcase}
                title="No open drives"
                hint="Eligible drives from companies recruiting at your university appear here."
              />
            ) : (
              <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {data.drives.map((d) => (
                  <li key={d.publicId}>
                    <Link
                      to={`/app/student/drives/${d.publicId}`}
                      className="block rounded-xl border border-line bg-bg p-4 transition-colors hover:border-line-strong"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-semibold tracking-tight text-fg">{d.title}</p>
                        {d.myApplicationStatus ? (
                          <ApplicationStatusBadge status={d.myApplicationStatus} />
                        ) : null}
                      </div>
                      <p className="mt-1 text-[13px] text-muted">{d.company.name}</p>
                      <div className="mt-3 flex flex-wrap items-center gap-3 text-[12px] text-faint">
                        {d.roleTitle ? (
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="h-3.5 w-3.5" /> {d.roleTitle}
                          </span>
                        ) : null}
                        <span className="inline-flex items-center gap-1">
                          <CalendarClock className="h-3.5 w-3.5" />{' '}
                          {formatDeadline(d.applyDeadline)}
                        </span>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        ) : null}
      </QueryState>
    </AppShell>
  );
}
