import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Briefcase,
  Trophy,
  FileText,
  GraduationCap,
  Code2,
  Video,
  MonitorPlay,
} from 'lucide-react';
import type {
  ArenaStats,
  HeatmapResponse,
  StudentDashboard as StudentData,
} from '@code-nexus/types';
import { api } from '../../lib/api.ts';
import { formatDeadline } from '../../lib/drives.ts';
import { arenaKeys } from '../../lib/arena.ts';
import { AppShell } from '../../components/dashboard/AppShell.tsx';
import { Panel } from '../../components/dashboard/Panel.tsx';
import { Calendar } from '../../components/dashboard/Calendar.tsx';
import { EmptyState } from '../../components/dashboard/EmptyState.tsx';
import { QueryState } from '../../components/dashboard/QueryState.tsx';
import { ApplicationStatusBadge } from '../../components/drives/DriveBadges.tsx';
import { ContributionHeatmap } from '../../components/arena/ContributionHeatmap.tsx';

export function StudentDashboard() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['dashboard', 'student'],
    queryFn: () => api.get<StudentData>('/dashboard'),
  });
  const year = new Date().getFullYear();
  const heatmapQuery = useQuery({
    queryKey: arenaKeys.heatmap(year),
    queryFn: () => api.get<HeatmapResponse>(`/arena/heatmap?year=${year}`),
  });
  const statsQuery = useQuery({
    queryKey: arenaKeys.stats,
    queryFn: () => api.get<ArenaStats>('/arena/stats'),
  });

  return (
    <AppShell title="Student Dashboard">
      <QueryState isLoading={isLoading} isError={isError} onRetry={() => refetch()}>
        {data ? (
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              <div className="space-y-6 lg:col-span-2">
                <Panel title="Your profile">
                  <div className="flex items-start gap-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent-soft text-accent">
                      <GraduationCap className="h-6 w-6" />
                    </div>
                    <div>
                      <p className="text-lg font-semibold tracking-tight text-fg">
                        {[data.profile.firstName, data.profile.lastName]
                          .filter(Boolean)
                          .join(' ') || '—'}
                      </p>
                      <p className="text-[13px] text-muted">{data.profile.university}</p>
                    </div>
                  </div>
                  <dl className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
                    <Detail label="Roll no." value={data.profile.rollNumber} />
                    <Detail label="Branch" value={data.profile.branch} />
                    <Detail label="Grad year" value={data.profile.graduationYear} />
                    <Detail label="CGPA" value={data.profile.cgpa} />
                  </dl>
                </Panel>

                <Panel
                  title="Upcoming placement drives"
                  action={
                    <Link to="/app/student/drives" className="text-[13px] font-medium text-accent">
                      View all
                    </Link>
                  }
                >
                  {data.upcomingDrives.length === 0 ? (
                    <EmptyState
                      icon={Briefcase}
                      title="No open drives"
                      hint="Eligible drives at your university will appear here."
                    />
                  ) : (
                    <ul className="divide-y divide-line">
                      {data.upcomingDrives.map((d) => (
                        <li key={d.publicId}>
                          <Link
                            to={`/app/student/drives/${d.publicId}`}
                            className="flex items-center justify-between gap-3 py-3 hover:text-accent"
                          >
                            <div>
                              <p className="text-sm font-medium text-fg">{d.title}</p>
                              <p className="text-[12px] text-muted">{d.company.name}</p>
                            </div>
                            <div className="flex items-center gap-2 text-[12px] text-faint">
                              {d.myApplicationStatus ? (
                                <ApplicationStatusBadge status={d.myApplicationStatus} />
                              ) : null}
                              <span>{formatDeadline(d.applyDeadline)}</span>
                            </div>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </Panel>

                <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                  <Panel
                    title="Contests"
                    action={
                      <Link to="/app/contests" className="text-[13px] font-medium text-accent">
                        View all
                      </Link>
                    }
                  >
                    {data.contests.length === 0 ? (
                      <EmptyState icon={Trophy} title="No contests" />
                    ) : (
                      <ul className="divide-y divide-line">
                        {data.contests.map((c) => {
                          const midAttempt = c.startedAt && !c.submittedAt;
                          const open = c.phase === 'open';
                          return (
                            <li key={c.publicId}>
                              <Link
                                to={
                                  midAttempt
                                    ? `/app/contests/${c.publicId}/arena`
                                    : `/app/contests/${c.publicId}`
                                }
                                className="flex items-center justify-between gap-2 py-2.5 hover:text-accent"
                              >
                                <span className="truncate text-[13px] font-medium text-fg">
                                  {c.title}
                                </span>
                                <span
                                  className={`mono-label shrink-0 text-[9px] ${
                                    open ? 'text-success' : 'text-info'
                                  }`}
                                >
                                  {open ? '● OPEN' : 'UPCOMING'}
                                </span>
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </Panel>
                  <Panel
                    title="Your applications"
                    action={
                      <Link
                        to="/app/student/applications"
                        className="text-[13px] font-medium text-accent"
                      >
                        View all
                      </Link>
                    }
                  >
                    {data.applications.total === 0 ? (
                      <EmptyState icon={FileText} title="No applications yet" />
                    ) : (
                      <dl className="grid grid-cols-3 gap-3 text-center">
                        <Stat label="Active" value={data.applications.active} />
                        <Stat label="Offers" value={data.applications.offers} />
                        <Stat label="Rejected" value={data.applications.rejected} />
                      </dl>
                    )}
                  </Panel>
                </div>

                <Panel
                  title="Webinars"
                  action={
                    <Link to="/app/webinars" className="text-[13px] font-medium text-accent">
                      View all
                    </Link>
                  }
                >
                  {data.webinars.length === 0 ? (
                    <EmptyState icon={Video} title="No webinars scheduled" />
                  ) : (
                    <ul className="divide-y divide-line">
                      {data.webinars.map((w) => {
                        const live = w.status === 'LIVE';
                        return (
                          <li key={w.publicId}>
                            <Link
                              to={`/app/webinars/${w.publicId}`}
                              className="flex items-center justify-between gap-2 py-2.5 hover:text-accent"
                            >
                              <span className="truncate text-[13px] font-medium text-fg">
                                {w.title}
                              </span>
                              <span
                                className={`mono-label shrink-0 text-[9px] ${
                                  live ? 'text-danger' : 'text-info'
                                }`}
                              >
                                {live ? '● LIVE' : 'SCHEDULED'}
                              </span>
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </Panel>

                <Panel
                  title="Interviews"
                  action={
                    <Link to="/app/interviews" className="text-[13px] font-medium text-accent">
                      View all
                    </Link>
                  }
                >
                  {data.interviews.length === 0 ? (
                    <EmptyState icon={MonitorPlay} title="No interviews scheduled" />
                  ) : (
                    <ul className="divide-y divide-line">
                      {data.interviews.map((iv) => {
                        const live = iv.status === 'LIVE';
                        return (
                          <li key={iv.publicId}>
                            <Link
                              to={`/app/interviews/${iv.publicId}`}
                              className="flex items-center justify-between gap-2 py-2.5 hover:text-accent"
                            >
                              <span className="truncate text-[13px] font-medium text-fg">
                                {iv.title ?? 'Interview'} · {iv.host.name}
                              </span>
                              <span
                                className={`mono-label shrink-0 text-[9px] ${
                                  live ? 'text-danger' : 'text-info'
                                }`}
                              >
                                {live ? '● LIVE' : 'SCHEDULED'}
                              </span>
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </Panel>
              </div>

              <div className="lg:col-span-1">
                <Calendar />
              </div>
            </div>

            <Panel
              title="Code Arena activity"
              action={
                <Link to="/app/arena" className="text-[13px] font-medium text-accent">
                  Practice
                </Link>
              }
            >
              {statsQuery.data ? (
                <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Stat label="Solved" value={statsQuery.data.solved.total} />
                  <Stat label="Easy" value={statsQuery.data.solved.easy} />
                  <Stat label="Medium" value={statsQuery.data.solved.medium} />
                  <Stat label="Hard" value={statsQuery.data.solved.hard} />
                </div>
              ) : null}
              {heatmapQuery.data ? (
                <ContributionHeatmap year={year} days={heatmapQuery.data.days} />
              ) : (
                <div className="flex items-center gap-2 text-[13px] text-muted">
                  <Code2 className="h-4 w-4 text-faint" /> Start solving to build your streak.
                </div>
              )}
            </Panel>
          </div>
        ) : null}
      </QueryState>
    </AppShell>
  );
}

function Detail({ label, value }: { label: string; value: string | number | null }) {
  return (
    <div>
      <dt className="mono-label text-[10px] text-faint">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium text-fg">{value ?? '—'}</dd>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-line bg-bg py-3">
      <dd className="text-xl font-semibold tracking-tight text-fg">{value}</dd>
      <dt className="mono-label mt-0.5 text-[9px] text-faint">{label}</dt>
    </div>
  );
}
