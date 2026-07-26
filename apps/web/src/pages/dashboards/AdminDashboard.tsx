import { useQuery } from '@tanstack/react-query';
import {
  Landmark,
  Building2,
  GraduationCap,
  UserSearch,
  ShieldAlert,
  LifeBuoy,
  Activity,
  Briefcase,
  FolderOpen,
  FileText,
} from 'lucide-react';
import type { AdminDashboard as AdminData } from '@code-nexus/types';
import { api } from '../../lib/api.ts';
import { AppShell } from '../../components/dashboard/AppShell.tsx';
import { Panel } from '../../components/dashboard/Panel.tsx';
import { EmptyState } from '../../components/dashboard/EmptyState.tsx';
import { QueryState } from '../../components/dashboard/QueryState.tsx';
import { StatRow, StatTile } from '../../components/dashboard/StatTile.tsx';

export function AdminDashboard() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['dashboard', 'admin'],
    queryFn: () => api.get<AdminData>('/dashboard'),
  });

  return (
    <AppShell title="Code Nexus Admin">
      <QueryState isLoading={isLoading} isError={isError} onRetry={() => refetch()}>
        {data ? (
          <div className="space-y-6">
            <StatRow>
              <StatTile label="Universities" value={data.counts.universities} icon={Landmark} />
              <StatTile label="Companies" value={data.counts.companies} icon={Building2} />
              <StatTile label="Students" value={data.counts.students} icon={GraduationCap} />
              <StatTile label="Recruiters" value={data.counts.recruiters} icon={UserSearch} />
            </StatRow>
            <StatRow>
              <StatTile label="Drives" value={data.counts.drives} icon={Briefcase} />
              <StatTile label="Open drives" value={data.counts.openDrives} icon={FolderOpen} />
              <StatTile label="Applications" value={data.counts.applications} icon={FileText} />
              <StatTile label="Suspended" value={data.counts.suspended} icon={ShieldAlert} />
            </StatRow>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              <Panel title="Suspended accounts" className="lg:col-span-1">
                <div className="flex items-center gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-red-500/10 text-red-500">
                    <ShieldAlert className="h-6 w-6" />
                  </div>
                  <p className="text-3xl font-semibold tracking-tight text-fg">
                    {data.counts.suspended}
                  </p>
                </div>
              </Panel>

              <Panel title="Help center" className="lg:col-span-1">
                <EmptyState icon={LifeBuoy} title="No open tickets" comingIn="Later" />
              </Panel>

              <Panel title="System health" className="lg:col-span-1">
                <EmptyState icon={Activity} title="Monitoring coming soon" comingIn="Later" />
              </Panel>
            </div>
          </div>
        ) : null}
      </QueryState>
    </AppShell>
  );
}
