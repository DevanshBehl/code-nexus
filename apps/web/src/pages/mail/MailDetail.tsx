import { useEffect } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Reply } from 'lucide-react';
import type { MailDetail as MailDetailDto } from '@code-nexus/types';
import { api } from '../../lib/api.ts';
import { mailKeys, roleLabel } from '../../lib/mail.ts';
import { useAuth } from '../../lib/auth.tsx';
import { AppShell } from '../../components/dashboard/AppShell.tsx';
import { Panel } from '../../components/dashboard/Panel.tsx';
import { QueryState } from '../../components/dashboard/QueryState.tsx';

export function MailDetail() {
  const { publicId = '' } = useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { me } = useAuth();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: mailKeys.detail(publicId),
    queryFn: () => api.get<MailDetailDto>(`/mail/${publicId}`),
  });

  // Opening a mail marks it read server-side — refresh the unread badge + inbox.
  useEffect(() => {
    if (data) {
      void qc.invalidateQueries({ queryKey: mailKeys.unread });
      void qc.invalidateQueries({ queryKey: ['mail', 'inbox'] });
    }
  }, [data, qc]);

  // Reply is offered only when the viewer is a recipient (i.e. the sender is
  // someone who mailed us); the server still enforces canMail on send.
  const canReply = data && me ? data.sender.publicId !== me.publicId : false;

  const reply = () => {
    if (!data) return;
    navigate('/app/mail/compose', {
      state: {
        recipient: data.sender,
        subject: data.subject.startsWith('Re: ') ? data.subject : `Re: ${data.subject}`,
      },
    });
  };

  return (
    <AppShell title="Mail">
      <Link
        to="/app/mail"
        className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-fg"
      >
        <ArrowLeft className="h-4 w-4" /> Back to inbox
      </Link>
      <QueryState isLoading={isLoading} isError={isError} onRetry={() => refetch()}>
        {data ? (
          <Panel
            title={data.subject}
            action={
              canReply ? (
                <button
                  type="button"
                  onClick={reply}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-line-strong px-3 py-1.5 text-[13px] font-medium text-fg hover:bg-surface-2"
                >
                  <Reply className="h-3.5 w-3.5" /> Reply
                </button>
              ) : null
            }
          >
            <div className="flex flex-wrap items-center gap-2 border-b border-line pb-4 text-[13px]">
              <span className="font-medium text-fg">{data.sender.displayName}</span>
              <span className="mono-label text-[9px] text-faint">
                {roleLabel(data.sender.role)}
              </span>
              {data.system ? (
                <span className="mono-label rounded-full border border-line px-1.5 py-0.5 text-[8px] text-faint">
                  Automated
                </span>
              ) : null}
              <span className="ml-auto text-[12px] text-faint">
                {new Date(data.sentAt).toLocaleString()}
              </span>
            </div>
            <p className="mt-2 text-[12px] text-muted">
              To: {data.recipients.map((r) => r.displayName).join(', ')}
            </p>
            <div className="mt-5 whitespace-pre-wrap text-[14px] leading-relaxed text-fg">
              {data.body}
            </div>
          </Panel>
        ) : null}
      </QueryState>
    </AppShell>
  );
}
