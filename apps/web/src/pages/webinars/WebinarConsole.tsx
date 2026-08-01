import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Ban, Copy, Pencil, Plus, Radio, Rocket, Square, Trash2, X } from 'lucide-react';
import {
  pollCreateSchema,
  webinarUpdateSchema,
  type AttendanceResponse,
  type PollDto,
  type WebinarDetail,
} from '@code-nexus/types';
import { api, ApiError } from '../../lib/api.ts';
import { webinarKeys, formatDateTime } from '../../lib/webinars.ts';
import { useWebinarRoom } from '../../lib/useWebinarRoom.ts';
import { AppShell } from '../../components/dashboard/AppShell.tsx';
import { Panel } from '../../components/dashboard/Panel.tsx';
import { QueryState } from '../../components/dashboard/QueryState.tsx';
import { TextField, FormError } from '../../components/forms/Field.tsx';
import { HlsPlayer } from '../../components/webinars/HlsPlayer.tsx';
import { ChatPanel } from '../../components/webinars/ChatPanel.tsx';
import { PollCard } from '../../components/webinars/PollCard.tsx';
import {
  AttendanceTable,
  PresencePill,
  WebinarStatusBadge,
} from '../../components/webinars/WebinarBits.tsx';
import { WebinarRoom } from './WebinarRoom.tsx';

/**
 * The host console (and the route dispatcher for `/app/webinars/:publicId`): a
 * host manages lifecycle, sees ingest credentials, moderates chat, runs polls,
 * and watches attendance. A non-host (student) is handed to the WebinarRoom.
 */
export function WebinarConsole() {
  const { publicId = '' } = useParams();
  const detail = useQuery({
    queryKey: webinarKeys.detail(publicId),
    queryFn: () => api.get<WebinarDetail>(`/webinars/${publicId}`),
  });

  // Students never see the console — send them straight to the room.
  if (detail.data && !detail.data.canManage) {
    return <WebinarRoom publicId={publicId} />;
  }

  return (
    <AppShell title={detail.data?.title ?? 'Webinar'} fullBleed>
      <div className="mx-auto w-full max-w-6xl px-4 py-4">
        <Link
          to="/app/webinars"
          className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-fg"
        >
          <ArrowLeft className="h-4 w-4" /> Webinars
        </Link>
        <QueryState
          isLoading={detail.isLoading}
          isError={detail.isError}
          onRetry={() => detail.refetch()}
        >
          {detail.data ? <Console webinar={detail.data} publicId={publicId} /> : null}
        </QueryState>
      </div>
    </AppShell>
  );
}

function Console({ webinar, publicId }: { webinar: WebinarDetail; publicId: string }) {
  const qc = useQueryClient();
  const [actionError, setActionError] = useState<string>();
  const [editing, setEditing] = useState(false);
  const live = webinar.status === 'LIVE';
  const room = useWebinarRoom(publicId, live, webinar.status === 'ENDED');

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: webinarKeys.detail(publicId) });
    void qc.invalidateQueries({ queryKey: webinarKeys.list });
  };

  const lifecycle = useMutation({
    mutationFn: (action: 'publish' | 'cancel' | 'go-live' | 'end') =>
      api.post(`/webinars/${publicId}/${action}`),
    onSuccess: invalidate,
    onError: (e) => setActionError(e instanceof ApiError ? e.message : 'Action failed'),
  });

  const attendance = useQuery({
    queryKey: webinarKeys.attendance(publicId),
    queryFn: () => api.get<AttendanceResponse>(`/webinars/${publicId}/attendance`),
    refetchInterval: live ? 10_000 : false,
  });

  return (
    <div className="space-y-4">
      <Panel
        title={webinar.title}
        action={
          <div className="flex items-center gap-2">
            <WebinarStatusBadge status={webinar.status} />
            {live ? <PresencePill count={room.presence} /> : null}
          </div>
        }
      >
        {actionError ? <FormError message={actionError} /> : null}
        {editing ? (
          <EditWebinar
            webinar={webinar}
            onCancel={() => setEditing(false)}
            onSaved={() => {
              setEditing(false);
              invalidate();
            }}
          />
        ) : (
          <>
            <p className="whitespace-pre-wrap text-[13px] text-muted">{webinar.description}</p>
            <dl className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Detail label="Host" value={webinar.host.name} />
              <Detail label="University" value={webinar.targetUniversity.name} />
              <Detail label="Scheduled" value={formatDateTime(webinar.scheduledStartsAt)} />
              <Detail
                label="Started"
                value={webinar.startedAt ? formatDateTime(webinar.startedAt) : '—'}
              />
            </dl>

            {/* Lifecycle actions */}
            <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-line pt-5">
              {webinar.status === 'DRAFT' || webinar.status === 'SCHEDULED' ? (
                <button
                  type="button"
                  onClick={() => {
                    setActionError(undefined);
                    setEditing(true);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-line-strong px-3.5 py-2 text-[13px] font-medium text-fg hover:bg-surface-2"
                >
                  <Pencil className="h-4 w-4" /> Edit
                </button>
              ) : null}
              {webinar.status === 'DRAFT' ? (
                <button
                  type="button"
                  disabled={lifecycle.isPending}
                  onClick={() => lifecycle.mutate('publish')}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-fg px-3.5 py-2 text-[13px] font-medium text-bg hover:opacity-90 disabled:opacity-50"
                >
                  <Rocket className="h-4 w-4" /> Publish
                </button>
              ) : null}
              {webinar.status === 'SCHEDULED' ? (
                <button
                  type="button"
                  disabled={lifecycle.isPending}
                  onClick={() => lifecycle.mutate('go-live')}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-danger-solid px-3.5 py-2 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-50"
                >
                  <Radio className="h-4 w-4" /> Go live
                </button>
              ) : null}
              {live ? (
                <button
                  type="button"
                  disabled={lifecycle.isPending}
                  onClick={() => {
                    if (confirm('End this webinar for everyone?')) lifecycle.mutate('end');
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-danger-solid px-3.5 py-2 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-50"
                >
                  <Square className="h-4 w-4" /> End webinar
                </button>
              ) : null}
              {webinar.status === 'DRAFT' || webinar.status === 'SCHEDULED' ? (
                <button
                  type="button"
                  disabled={lifecycle.isPending}
                  onClick={() => lifecycle.mutate('cancel')}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-line-strong px-3.5 py-2 text-[13px] font-medium text-danger hover:bg-surface-2 disabled:opacity-50"
                >
                  <Ban className="h-4 w-4" /> Cancel
                </button>
              ) : null}
            </div>
          </>
        )}
      </Panel>

      {/* Host ingest credentials (host-only) */}
      {live && webinar.ingest && !editing ? <IngestPanel ingest={webinar.ingest} /> : null}

      {/* Live room: preview + chat + polls + attendance */}
      {live && !editing ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_22rem]">
          <div className="space-y-4">
            <HlsPlayer playbackUrl={webinar.playbackUrl} live={!room.ended} />
            <PollManager
              publicId={publicId}
              polls={room.polls}
              onOpened={room.addPollLocally}
              onClosed={room.markPollClosedLocally}
            />
            <Panel title="Attendance">
              <AttendanceTable rows={attendance.data?.attendance ?? []} />
            </Panel>
          </div>
          <aside className="flex h-[70vh] flex-col rounded-2xl border border-line bg-surface p-4">
            <h2 className="mb-3 text-[13px] font-semibold text-fg">Chat</h2>
            <div className="min-h-0 flex-1">
              <ChatPanel
                messages={room.messages}
                onSend={room.sendChat}
                disabled={room.status !== 'open'}
              />
            </div>
          </aside>
        </div>
      ) : null}

      {webinar.status === 'ENDED' && !editing ? (
        <Panel title="Attendance">
          <AttendanceTable rows={attendance.data?.attendance ?? []} />
        </Panel>
      ) : null}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="mono-label text-[10px] text-faint">{label}</dt>
      <dd className="mt-1 text-[13px] font-medium text-fg">{value}</dd>
    </div>
  );
}

function IngestPanel({ ingest }: { ingest: { ingestUrl: string; streamKey: string } }) {
  const [copied, setCopied] = useState<string>();
  const copy = (label: string, value: string): void => {
    void navigator.clipboard?.writeText(value);
    setCopied(label);
    setTimeout(() => setCopied(undefined), 1500);
  };
  return (
    <Panel title="Stream from your encoder (OBS)">
      <p className="mb-4 text-[13px] text-muted">
        Point OBS (or any RTMP encoder) at the server below using the stream key. These are private
        — never share them with viewers.
      </p>
      <div className="space-y-3">
        <CopyRow label="RTMP server" value={ingest.ingestUrl} copied={copied} onCopy={copy} />
        <CopyRow label="Stream key" value={ingest.streamKey} copied={copied} onCopy={copy} secret />
      </div>
    </Panel>
  );
}

function CopyRow({
  label,
  value,
  copied,
  onCopy,
  secret,
}: {
  label: string;
  value: string;
  copied?: string;
  onCopy: (label: string, value: string) => void;
  secret?: boolean;
}) {
  return (
    <div>
      <span className="mono-label mb-1 block text-[10px] text-faint">{label}</span>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg border border-line-strong bg-surface-2 px-3 py-2 text-[12px] text-fg">
          {secret ? '•'.repeat(Math.min(value.length, 24)) : value}
        </code>
        <button
          type="button"
          onClick={() => onCopy(label, value)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line-strong px-3 py-2 text-[12px] font-medium text-fg hover:bg-surface-2"
        >
          <Copy className="h-3.5 w-3.5" /> {copied === label ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

function PollManager({
  publicId,
  polls,
  onOpened,
  onClosed,
}: {
  publicId: string;
  polls: PollDto[];
  onOpened: (poll: PollDto) => void;
  onClosed: (pollPublicId: string) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [error, setError] = useState<string>();

  const create = useMutation({
    mutationFn: (body: { question: string; options: string[] }) =>
      api.post<PollDto>(`/webinars/${publicId}/polls`, body),
    onSuccess: (poll) => {
      onOpened(poll);
      setCreating(false);
      setQuestion('');
      setOptions(['', '']);
      setError(undefined);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not open the poll'),
  });
  const close = useMutation({
    mutationFn: (pollPublicId: string) =>
      api.post(`/webinars/${publicId}/polls/${pollPublicId}/close`),
    onSuccess: (_r, pollPublicId) => onClosed(pollPublicId),
  });

  const submit = (): void => {
    const body = {
      question: question.trim(),
      options: options.map((o) => o.trim()).filter(Boolean),
    };
    const parsed = pollCreateSchema.safeParse(body);
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => i.message).join('; '));
      return;
    }
    create.mutate(parsed.data);
  };

  return (
    <Panel
      title="Polls"
      action={
        !creating ? (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line-strong px-3 py-1.5 text-[13px] font-medium text-fg hover:bg-surface-2"
          >
            <Plus className="h-3.5 w-3.5" /> New poll
          </button>
        ) : undefined
      }
    >
      {creating ? (
        <div className="mb-4 space-y-3 rounded-xl border border-line bg-surface-2 p-4">
          <FormError message={error} />
          <TextField
            id="poll-q"
            label="Question"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
          />
          <div className="space-y-2">
            <span className="text-[13px] font-medium text-fg">Options</span>
            {options.map((opt, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  value={opt}
                  onChange={(e) =>
                    setOptions((cur) => cur.map((o, j) => (j === i ? e.target.value : o)))
                  }
                  placeholder={`Option ${i + 1}`}
                  className="min-w-0 flex-1 rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none"
                />
                {options.length > 2 ? (
                  <button
                    type="button"
                    onClick={() => setOptions((cur) => cur.filter((_, j) => j !== i))}
                    className="rounded-lg border border-line-strong p-2 text-muted hover:bg-surface"
                    aria-label="Remove option"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>
            ))}
            {options.length < 6 ? (
              <button
                type="button"
                onClick={() => setOptions((cur) => [...cur, ''])}
                className="text-[12px] font-medium text-accent hover:underline"
              >
                + Add option
              </button>
            ) : null}
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={create.isPending}
              onClick={submit}
              className="rounded-lg bg-fg px-3.5 py-2 text-[13px] font-medium text-bg hover:opacity-90 disabled:opacity-50"
            >
              {create.isPending ? 'Opening…' : 'Open poll'}
            </button>
            <button
              type="button"
              onClick={() => {
                setCreating(false);
                setError(undefined);
              }}
              className="inline-flex items-center gap-1 text-[13px] font-medium text-muted hover:text-fg"
            >
              <X className="h-3.5 w-3.5" /> Cancel
            </button>
          </div>
        </div>
      ) : null}

      {polls.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-muted">No polls yet.</p>
      ) : (
        <div className="space-y-3">
          {polls.map((p) => (
            <PollCard key={p.publicId} poll={p} onClose={() => close.mutate(p.publicId)} />
          ))}
        </div>
      )}
    </Panel>
  );
}

function EditWebinar({
  webinar,
  onCancel,
  onSaved,
}: {
  webinar: WebinarDetail;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(webinar.title);
  const [description, setDescription] = useState(webinar.description);
  const [scheduledStartsAt, setScheduledStartsAt] = useState(
    toDateTimeLocal(webinar.scheduledStartsAt),
  );
  const [error, setError] = useState<string>();

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch(`/webinars/${webinar.publicId}`, body),
    onSuccess: onSaved,
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not save changes'),
  });

  const submit = (e: React.FormEvent): void => {
    e.preventDefault();
    const body = {
      title,
      description,
      scheduledStartsAt: scheduledStartsAt ? new Date(scheduledStartsAt).toISOString() : undefined,
    };
    const parsed = webinarUpdateSchema.safeParse(body);
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => i.message).join('; '));
      return;
    }
    save.mutate(parsed.data);
  };

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <FormError message={error} />
      <TextField
        id="e-title"
        label="Title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <label className="block" htmlFor="e-desc">
        <span className="mb-1.5 block text-[13px] font-medium text-fg">Description</span>
        <textarea
          id="e-desc"
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none"
        />
      </label>
      <TextField
        id="e-start"
        label="Scheduled start"
        type="datetime-local"
        value={scheduledStartsAt}
        onChange={(e) => setScheduledStartsAt(e.target.value)}
      />
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={save.isPending}
          className="rounded-lg bg-fg px-4 py-2.5 text-sm font-medium text-bg hover:opacity-90 disabled:opacity-50"
        >
          {save.isPending ? 'Saving…' : 'Save changes'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-[13px] font-medium text-muted hover:text-fg"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

/** ISO → value for a <input type="datetime-local"> (local time, no seconds). */
function toDateTimeLocal(iso: string): string {
  const d = new Date(iso);
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 16);
}
