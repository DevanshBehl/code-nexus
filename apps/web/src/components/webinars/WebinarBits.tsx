import type { AttendanceRow, WebinarStatus } from '@code-nexus/types';
import { Users } from 'lucide-react';
import { STATUS_LABEL, STATUS_STYLE, formatDateTime, formatDuration } from '../../lib/webinars.ts';

export function WebinarStatusBadge({ status }: { status: WebinarStatus }) {
  return (
    <span
      className={`mono-label rounded-full border px-2 py-0.5 text-[9px] ${STATUS_STYLE[status]}`}
    >
      {status === 'LIVE' ? '● ' : ''}
      {STATUS_LABEL[status]}
    </span>
  );
}

export function PresencePill({ count }: { count: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-surface px-2.5 py-1 text-[12px] font-medium text-fg">
      <Users className="h-3.5 w-3.5 text-muted" aria-hidden="true" />
      <span className="tabular-nums">{count}</span> watching
    </span>
  );
}

export function AttendanceTable({ rows }: { rows: AttendanceRow[] }) {
  if (rows.length === 0) {
    return <p className="py-8 text-center text-[13px] text-muted">No attendees yet.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[32rem] border-collapse text-left">
        <thead>
          <tr className="border-b border-line">
            <th className="mono-label px-3 py-2 text-[10px] text-faint">Attendee</th>
            <th className="mono-label px-3 py-2 text-[10px] text-faint">Joined</th>
            <th className="mono-label px-3 py-2 text-[10px] text-faint">Attended</th>
            <th className="mono-label px-3 py-2 text-[10px] text-faint">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.studentPublicId}
              className="border-b border-line last:border-0 hover:bg-surface-2"
            >
              <td className="px-3 py-2.5 text-[13px] font-medium text-fg">{r.displayName}</td>
              <td className="px-3 py-2.5 text-[12px] text-muted">
                {formatDateTime(r.firstJoinedAt)}
              </td>
              <td className="px-3 py-2.5 text-[13px] tabular-nums text-fg">
                {formatDuration(r.attendedSeconds)}
              </td>
              <td className="px-3 py-2.5 text-[12px]">
                {r.present ? (
                  <span className="text-emerald-500">● Present</span>
                ) : (
                  <span className="text-faint">Left</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
