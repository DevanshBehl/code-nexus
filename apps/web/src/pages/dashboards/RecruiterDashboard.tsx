import { useQuery } from '@tanstack/react-query';
import { UserSearch, Video, ListChecks } from 'lucide-react';
import type { RecruiterDashboard as RecruiterData } from '@code-nexus/types';
import { api } from '../../lib/api.ts';
import { AppShell } from '../../components/dashboard/AppShell.tsx';
import { Panel } from '../../components/dashboard/Panel.tsx';
import { Calendar } from '../../components/dashboard/Calendar.tsx';
import { EmptyState } from '../../components/dashboard/EmptyState.tsx';
import { QueryState } from '../../components/dashboard/QueryState.tsx';

export function RecruiterDashboard() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['dashboard', 'recruiter'],
    queryFn: () => api.get<RecruiterData>('/dashboard'),
  });

  return (
    <AppShell title="Recruiter Dashboard">
      <QueryState isLoading={isLoading} isError={isError} onRetry={() => refetch()}>
        {data ? (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="space-y-6 lg:col-span-2">
              <Panel title="Your profile">
                <div className="flex items-start gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent-soft text-accent">
                    <UserSearch className="h-6 w-6" />
                  </div>
                  <div>
                    <p className="text-lg font-semibold tracking-tight text-fg">
                      {[data.profile.firstName, data.profile.lastName].filter(Boolean).join(' ') ||
                        '—'}
                    </p>
                    <p className="text-[13px] text-muted">
                      {data.profile.designation ?? '—'} · {data.profile.company}
                    </p>
                  </div>
                </div>
              </Panel>

              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                <Panel title="Assigned interviews">
                  <EmptyState icon={Video} title="No interviews" comingIn="Phase 9" />
                </Panel>
                <Panel title="Question pool">
                  <EmptyState icon={ListChecks} title="No questions" comingIn="Phase 9" />
                </Panel>
              </div>
            </div>
            <div className="lg:col-span-1">
              <Calendar />
            </div>
          </div>
        ) : null}
      </QueryState>
    </AppShell>
  );
}
