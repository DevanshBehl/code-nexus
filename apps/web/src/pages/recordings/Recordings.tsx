import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Video } from 'lucide-react';
import type { RecordingListItem, RecordingListResponse } from '@code-nexus/types';
import { api } from '../../lib/api.ts';
import { formatDateTime } from '../../lib/interviews.ts';
import {
  formatBytes,
  formatDuration,
  recordingKeys,
  RECORDING_STATUS_LABEL,
  RECORDING_STATUS_STYLE,
} from '../../lib/recordings.ts';
import { AppShell } from '../../components/dashboard/AppShell.tsx';
import { Panel } from '../../components/dashboard/Panel.tsx';
import { QueryState } from '../../components/dashboard/QueryState.tsx';
import { EmptyState } from '../../components/dashboard/EmptyState.tsx';

/**
 * Interview recordings the caller is entitled to see. The api decides the scope
 * (candidate → own, recruiter → assigned, company → hosted, university → its
 * students, admin → all); this page just renders what comes back.
 */
export function Recordings() {
  const q = useQuery({
    queryKey: recordingKeys.list,
    queryFn: () => api.get<RecordingListResponse>('/recordings'),
  });

  return (
    <AppShell title="Recordings">
      <Panel title="Interview recordings">
        <QueryState isLoading={q.isLoading} isError={q.isError} onRetry={() => q.refetch()}>
          {q.data && q.data.recordings.length > 0 ? (
            <ul className="divide-y divide-line">
              {q.data.recordings.map((r) => (
                <RecordingRow key={r.publicId} recording={r} />
              ))}
            </ul>
          ) : (
            <EmptyState
              title="No recordings yet"
              hint="Interviews you take part in appear here once they have been recorded."
            />
          )}
        </QueryState>
      </Panel>
    </AppShell>
  );
}

function RecordingRow({ recording: r }: { recording: RecordingListItem }) {
  const playable = r.status === 'READY';
  const body = (
    <div className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <Video className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium text-fg">
            {r.interviewTitle ?? `Interview with ${r.candidateName}`}
          </p>
          <p className="mono-label text-[10px] text-faint">
            {formatDateTime(r.startedAt)} · {formatDuration(r.durationMs)} ·{' '}
            {formatBytes(r.totalBytes)}
          </p>
        </div>
      </div>
      <span
        className={`mono-label shrink-0 rounded-full border px-2 py-0.5 text-[9px] ${RECORDING_STATUS_STYLE[r.status]}`}
      >
        {RECORDING_STATUS_LABEL[r.status]}
      </span>
    </div>
  );

  return (
    <li>
      {playable ? (
        <Link
          to={`/app/recordings/${r.publicId}`}
          className="block rounded-lg px-2 hover:bg-surface-2"
        >
          {body}
        </Link>
      ) : (
        // Not playable — don't offer a link into a player that cannot play.
        <div className="px-2 opacity-70">{body}</div>
      )}
    </li>
  );
}
