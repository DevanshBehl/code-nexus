import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus, Video } from 'lucide-react';
import type { WebinarListItem, WebinarListResponse } from '@code-nexus/types';
import { api } from '../../lib/api.ts';
import { useAuth } from '../../lib/auth.tsx';
import { webinarKeys, formatDateTime } from '../../lib/webinars.ts';
import { AppShell } from '../../components/dashboard/AppShell.tsx';
import { Panel } from '../../components/dashboard/Panel.tsx';
import { QueryState } from '../../components/dashboard/QueryState.tsx';
import { WebinarStatusBadge } from '../../components/webinars/WebinarBits.tsx';

export function Webinars() {
  const { me } = useAuth();
  const isHost = me?.role === 'UNIVERSITY' || me?.role === 'COMPANY' || me?.role === 'ADMIN';

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: webinarKeys.list,
    queryFn: () => api.get<WebinarListResponse>('/webinars'),
  });

  return (
    <AppShell title="Webinars">
      <Panel
        title={isHost ? 'Your webinars' : 'Webinars'}
        action={
          isHost ? (
            <Link
              to="/app/webinars/new"
              className="inline-flex items-center gap-1.5 rounded-lg bg-fg px-3 py-1.5 text-[13px] font-medium text-bg hover:opacity-90"
            >
              <Plus className="h-3.5 w-3.5" /> New webinar
            </Link>
          ) : undefined
        }
      >
        <QueryState isLoading={isLoading} isError={isError} onRetry={() => refetch()}>
          {data && data.webinars.length > 0 ? (
            <ul className="divide-y divide-line">
              {data.webinars.map((w) => (
                <WebinarRow key={w.publicId} w={w} />
              ))}
            </ul>
          ) : (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <Video className="h-6 w-6 text-faint" aria-hidden="true" />
              <p className="text-[13px] text-muted">
                {isHost
                  ? 'No webinars yet. Schedule one to address students at scale.'
                  : 'No webinars scheduled for you yet.'}
              </p>
            </div>
          )}
        </QueryState>
      </Panel>
    </AppShell>
  );
}

function WebinarRow({ w }: { w: WebinarListItem }) {
  // A student jumps straight into the live room; everyone else opens the detail
  // page (host console for hosts).
  const to = `/app/webinars/${w.publicId}`;
  return (
    <li>
      <Link
        to={to}
        className="flex items-center justify-between gap-3 py-3 transition-colors hover:text-accent"
      >
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-fg">{w.title}</p>
          <p className="mt-0.5 text-[12px] text-muted">
            {w.host.name} · {formatDateTime(w.scheduledStartsAt)}
          </p>
        </div>
        <WebinarStatusBadge status={w.status} />
      </Link>
    </li>
  );
}
