import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Send, PenSquare } from 'lucide-react';
import type { SentPage } from '@code-nexus/types';
import { api } from '../../lib/api.ts';
import { mailKeys, formatMailTime } from '../../lib/mail.ts';
import { AppShell } from '../../components/dashboard/AppShell.tsx';
import { Panel } from '../../components/dashboard/Panel.tsx';
import { EmptyState } from '../../components/dashboard/EmptyState.tsx';
import { QueryState } from '../../components/dashboard/QueryState.tsx';
import { MailTabs } from '../../components/mail/MailTabs.tsx';
import { Pager } from '../../components/mail/Pager.tsx';

export function Sent() {
  const [page, setPage] = useState(1);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: mailKeys.sent(page),
    queryFn: () => api.get<SentPage>(`/mail/sent?page=${page}`),
  });

  return (
    <AppShell title="Mail">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <MailTabs active="sent" />
          <Link
            to="/app/mail/compose"
            className="inline-flex items-center gap-1.5 rounded-lg bg-fg px-3 py-1.5 text-[13px] font-medium text-bg transition-opacity hover:opacity-90"
          >
            <PenSquare className="h-3.5 w-3.5" /> Compose
          </Link>
        </div>

        <Panel title="Sent">
          <QueryState isLoading={isLoading} isError={isError} onRetry={() => refetch()}>
            {data ? (
              data.items.length === 0 ? (
                <EmptyState
                  icon={Send}
                  title="Nothing sent yet"
                  hint="Mail you send appears here."
                />
              ) : (
                <>
                  <ul className="divide-y divide-line">
                    {data.items.map((m) => (
                      <li key={m.publicId}>
                        <Link
                          to={`/app/mail/${m.publicId}`}
                          className="flex items-center gap-3 py-3 hover:bg-surface-2"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[13px] text-muted">
                              To: {m.recipients.map((r) => r.displayName).join(', ') || '—'}
                            </p>
                            <p className="truncate text-[13px] text-fg">{m.subject}</p>
                          </div>
                          <span className="shrink-0 text-[12px] text-faint">
                            {formatMailTime(m.sentAt)}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                  <Pager
                    page={data.page}
                    pageSize={data.pageSize}
                    total={data.total}
                    onPage={setPage}
                  />
                </>
              )
            ) : null}
          </QueryState>
        </Panel>
      </div>
    </AppShell>
  );
}
