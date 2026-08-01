import { useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Trophy,
  Plus,
  Trash2,
  Rocket,
  Ban,
  Play,
  Pencil,
  CheckCircle2,
} from 'lucide-react';
import {
  DIFFICULTIES,
  LANGUAGE_META,
  PROGRAMMING_LANGUAGES,
  TOPICS,
  contestUpdateSchema,
  type ContestDetail as ContestDetailDto,
  type ProgrammingLanguage,
} from '@code-nexus/types';
import type { UseMutationResult } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api.ts';
import { contestKeys, formatDateTime } from '../../lib/contests.ts';
import { requestFullscreenNow } from '../../lib/roomLock.ts';
import { AppShell } from '../../components/dashboard/AppShell.tsx';
import { Panel } from '../../components/dashboard/Panel.tsx';
import { QueryState } from '../../components/dashboard/QueryState.tsx';
import { ContestPhaseBadge, Countdown } from '../../components/contests/ContestBits.tsx';
import { TextField, SelectField, FormError } from '../../components/forms/Field.tsx';

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function ContestDetail() {
  const { publicId = '' } = useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [actionError, setActionError] = useState<string>();
  const [editing, setEditing] = useState(false);

  const {
    data: c,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: contestKeys.detail(publicId),
    queryFn: () => api.get<ContestDetailDto>(`/contests/${publicId}`),
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: contestKeys.detail(publicId) });
    void qc.invalidateQueries({ queryKey: contestKeys.list });
  };

  const lifecycle = useMutation({
    mutationFn: (action: 'publish' | 'cancel') => api.post(`/contests/${publicId}/${action}`),
    onSuccess: invalidate,
    onError: (e) => setActionError(e instanceof ApiError ? e.message : 'Action failed'),
  });
  // Starting is one-way: it begins the timer and takes the student into the arena.
  const start = useMutation({
    mutationFn: () => api.post(`/contests/${publicId}/start`),
    onSuccess: () => {
      invalidate();
      navigate(`/app/contests/${publicId}/arena`);
    },
    onError: (e) => setActionError(e instanceof ApiError ? e.message : 'Could not start'),
  });

  return (
    <AppShell title="Contest">
      <Link
        to="/app/contests"
        className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-fg"
      >
        <ArrowLeft className="h-4 w-4" /> Contests
      </Link>
      <QueryState isLoading={isLoading} isError={isError} onRetry={() => refetch()}>
        {c ? (
          <div className="space-y-6">
            <Panel
              title={c.title}
              action={
                <div className="flex items-center gap-2">
                  <ContestPhaseBadge phase={c.phase} />
                  <Link
                    to={`/app/contests/${publicId}/leaderboard`}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-line-strong px-3 py-1.5 text-[13px] font-medium text-fg hover:bg-surface-2"
                  >
                    <Trophy className="h-3.5 w-3.5" /> Leaderboard
                  </Link>
                </div>
              }
            >
              {actionError ? <FormError message={actionError} /> : null}
              {editing ? (
                <EditContest
                  contest={c}
                  onCancel={() => setEditing(false)}
                  onSaved={() => {
                    setEditing(false);
                    invalidate();
                  }}
                />
              ) : (
                <>
                  <p className="whitespace-pre-wrap text-[13px] text-muted">{c.description}</p>
                  <dl className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
                    <Detail label="Host" value={`${c.host.name}`} />
                    <Detail label="University" value={c.targetUniversity.name} />
                    <Detail label="Entry opens" value={formatDateTime(c.startsAt)} />
                    <Detail label="Entry deadline" value={formatDateTime(c.entryDeadline)} />
                    <Detail label="Attempt length" value={`${c.durationMinutes} min`} />
                    <Detail label="Questions" value={c.questionCount} />
                    <Detail label="Participants" value={c.participantCount} />
                    <Detail
                      label="Languages"
                      value={c.allowedLanguages.map((l) => LANGUAGE_META[l].label).join(', ')}
                    />
                  </dl>

                  {/* Actions */}
                  <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-line pt-5">
                    {c.canManage ? (
                      <>
                        {c.phase === 'draft' || c.phase === 'upcoming' ? (
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
                        {c.status === 'DRAFT' ? (
                          <button
                            type="button"
                            disabled={lifecycle.isPending}
                            onClick={() => lifecycle.mutate('publish')}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-fg px-3.5 py-2 text-[13px] font-medium text-bg hover:opacity-90 disabled:opacity-50"
                          >
                            <Rocket className="h-4 w-4" /> Publish
                          </button>
                        ) : null}
                        {c.phase === 'draft' || c.phase === 'upcoming' ? (
                          <button
                            type="button"
                            disabled={lifecycle.isPending}
                            onClick={() => lifecycle.mutate('cancel')}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-line-strong px-3.5 py-2 text-[13px] font-medium text-danger hover:bg-surface-2 disabled:opacity-50"
                          >
                            <Ban className="h-4 w-4" /> Cancel
                          </button>
                        ) : null}
                      </>
                    ) : (
                      <StudentAction c={c} publicId={publicId} start={start} navigate={navigate} />
                    )}
                  </div>
                </>
              )}
            </Panel>

            {/* Host question management */}
            {c.canManage && !editing ? <ManageQuestions contest={c} onChange={invalidate} /> : null}
          </div>
        ) : null}
      </QueryState>
    </AppShell>
  );
}

/** The student's contextual entry action, based on phase + their attempt state. */
function StudentAction({
  c,
  publicId,
  start,
  navigate,
}: {
  c: ContestDetailDto;
  publicId: string;
  start: UseMutationResult<unknown, unknown, void, unknown>;
  navigate: (to: string) => void;
}) {
  if (c.submittedAt) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-success">
        <CheckCircle2 className="h-4 w-4" /> You have submitted this contest.
      </span>
    );
  }
  if (c.startedAt) {
    const active = c.attemptEndsAt && new Date(c.attemptEndsAt).getTime() > Date.now();
    if (active) {
      return (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => {
              // Ask while the click still counts as user activation — the arena
              // is a fullscreen locked room and asking on mount is often too late.
              requestFullscreenNow();
              navigate(`/app/contests/${publicId}/arena`);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-success-solid px-4 py-2 text-[13px] font-semibold text-white hover:opacity-90"
          >
            <Play className="h-4 w-4" /> Resume attempt
          </button>
          <span className="text-[13px] text-muted">
            Time left: <Countdown target={c.attemptEndsAt!} />
          </span>
        </div>
      );
    }
    return <span className="text-[13px] text-muted">Your attempt window has ended.</span>;
  }
  // Not started yet.
  if (c.phase === 'open') {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={start.isPending}
          onClick={() => {
            requestFullscreenNow();
            start.mutate();
          }}
          className="inline-flex items-center gap-1.5 rounded-lg bg-success-solid px-4 py-2 text-[13px] font-semibold text-white hover:opacity-90 disabled:opacity-50"
        >
          <Play className="h-4 w-4" /> Start contest
        </button>
        <span className="text-[13px] text-muted">
          Starts your {c.durationMinutes}-minute timer — one attempt. Entry closes in{' '}
          <Countdown target={c.entryDeadline} />.
        </span>
      </div>
    );
  }
  if (c.phase === 'upcoming') {
    return (
      <span className="text-[13px] text-muted">
        Entry opens in <Countdown target={c.startsAt} />.
      </span>
    );
  }
  return <span className="text-[13px] text-muted">Entry has closed for this contest.</span>;
}

function toDateTimeLocal(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}`;
}

/** Host edit form for a draft/upcoming contest. */
function EditContest({
  contest,
  onCancel,
  onSaved,
}: {
  contest: ContestDetailDto;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(contest.title);
  const [description, setDescription] = useState(contest.description);
  const [languages, setLanguages] = useState<ProgrammingLanguage[]>(contest.allowedLanguages);
  const [startsAt, setStartsAt] = useState(toDateTimeLocal(contest.startsAt));
  const [entryDeadline, setEntryDeadline] = useState(toDateTimeLocal(contest.entryDeadline));
  const [durationMinutes, setDurationMinutes] = useState(String(contest.durationMinutes));
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  const toggleLang = (l: ProgrammingLanguage) =>
    setLanguages((cur) => (cur.includes(l) ? cur.filter((x) => x !== l) : [...cur, l]));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(undefined);
    const payload = {
      title,
      description,
      allowedLanguages: languages,
      startsAt: startsAt ? new Date(startsAt).toISOString() : undefined,
      entryDeadline: entryDeadline ? new Date(entryDeadline).toISOString() : undefined,
      durationMinutes: Number(durationMinutes),
    };
    const parsed = contestUpdateSchema.safeParse(payload);
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => i.message).join('; '));
      return;
    }
    setSaving(true);
    try {
      await api.patch(`/contests/${contest.publicId}`, parsed.data);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save changes.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <FormError message={error} />
      <TextField
        id="title"
        label="Title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <label className="block">
        <span className="mb-1.5 block text-[13px] font-medium text-fg">Description</span>
        <textarea
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none"
        />
      </label>
      <div>
        <span className="mb-1.5 block text-[13px] font-medium text-fg">Allowed languages</span>
        <div className="flex flex-wrap gap-2">
          {PROGRAMMING_LANGUAGES.map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => toggleLang(l)}
              className={`rounded-lg border px-3 py-1.5 text-[12px] font-medium transition-colors ${
                languages.includes(l)
                  ? 'border-accent bg-accent-soft text-accent'
                  : 'border-line-strong text-muted hover:bg-surface-2'
              }`}
            >
              {LANGUAGE_META[l].label}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <TextField
          id="startsAt"
          label="Entry opens"
          type="datetime-local"
          value={startsAt}
          onChange={(e) => setStartsAt(e.target.value)}
        />
        <TextField
          id="entryDeadline"
          label="Entry deadline"
          type="datetime-local"
          value={entryDeadline}
          onChange={(e) => setEntryDeadline(e.target.value)}
        />
        <TextField
          id="durationMinutes"
          label="Attempt length (min)"
          type="number"
          value={durationMinutes}
          onChange={(e) => setDurationMinutes(e.target.value)}
        />
      </div>
      <div className="flex items-center gap-3 pt-1">
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center justify-center rounded-lg bg-fg px-4 py-2.5 text-sm font-medium text-bg hover:opacity-90 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save changes'}
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

function ManageQuestions({
  contest,
  onChange,
}: {
  contest: ContestDetailDto;
  onChange: () => void;
}) {
  const editable = contest.phase === 'draft' || contest.phase === 'upcoming';
  const [error, setError] = useState<string>();
  const [mode, setMode] = useState<'bank' | 'custom'>('bank');
  const [slug, setSlug] = useState('');
  const [busy, setBusy] = useState(false);

  // Custom question fields
  const [cTitle, setCTitle] = useState('');
  const [cDesc, setCDesc] = useState('');
  const [cDiff, setCDiff] = useState('EASY');
  const [cTopic, setCTopic] = useState('MATH');
  const [tests, setTests] = useState([{ input: '', expectedOutput: '', isSample: true }]);

  const addQuestion = async () => {
    setError(undefined);
    setBusy(true);
    try {
      const body =
        mode === 'bank'
          ? { mode: 'bank', slug }
          : {
              mode: 'custom',
              title: cTitle,
              description: cDesc,
              difficulty: cDiff,
              topic: cTopic,
              testCases: tests.filter((t) => t.input !== '' || t.expectedOutput !== ''),
            };
      await api.post(`/contests/${contest.publicId}/questions`, body);
      setSlug('');
      setCTitle('');
      setCDesc('');
      setTests([{ input: '', expectedOutput: '', isSample: true }]);
      onChange();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not add question');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (qSlug: string) => {
    setError(undefined);
    try {
      await api.del(`/contests/${contest.publicId}/questions/${qSlug}`);
      onChange();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not remove');
    }
  };

  return (
    <Panel title="Questions">
      {error ? <FormError message={error} /> : null}
      <ul className="mb-4 divide-y divide-line">
        {(contest.questions ?? []).map((q) => (
          <li key={q.slug} className="flex items-center justify-between gap-3 py-2.5">
            <span className="text-[13px] text-fg">
              <span className="mono-label mr-2 text-faint">Q{q.ordinal}</span>
              {q.title}{' '}
              <span className="mono-label text-[9px] text-faint">{titleCase(q.difficulty)}</span>
            </span>
            {editable ? (
              <button
                type="button"
                onClick={() => remove(q.slug)}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-faint hover:bg-surface-2 hover:text-danger"
                title="Remove"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </li>
        ))}
        {(contest.questions ?? []).length === 0 ? (
          <li className="py-3 text-[13px] text-muted">
            No questions yet — add at least one to publish.
          </li>
        ) : null}
      </ul>

      {editable ? (
        <div className="rounded-xl border border-line bg-surface-2 p-4">
          <div className="mb-3 flex gap-2">
            <ModeTab active={mode === 'bank'} onClick={() => setMode('bank')}>
              From bank
            </ModeTab>
            <ModeTab active={mode === 'custom'} onClick={() => setMode('custom')}>
              Custom
            </ModeTab>
          </div>
          {mode === 'bank' ? (
            <TextField
              id="slug"
              label="Bank question slug"
              placeholder="e.g. two-sum"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
            />
          ) : (
            <div className="space-y-3">
              <TextField
                id="cTitle"
                label="Title"
                value={cTitle}
                onChange={(e) => setCTitle(e.target.value)}
              />
              <label className="block">
                <span className="mb-1.5 block text-[13px] font-medium text-fg">Description</span>
                <textarea
                  rows={3}
                  value={cDesc}
                  onChange={(e) => setCDesc(e.target.value)}
                  className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none"
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <SelectField
                  id="cDiff"
                  label="Difficulty"
                  value={cDiff}
                  onChange={(e) => setCDiff(e.target.value)}
                >
                  {DIFFICULTIES.map((d) => (
                    <option key={d} value={d}>
                      {titleCase(d)}
                    </option>
                  ))}
                </SelectField>
                <SelectField
                  id="cTopic"
                  label="Topic"
                  value={cTopic}
                  onChange={(e) => setCTopic(e.target.value)}
                >
                  {TOPICS.map((t) => (
                    <option key={t} value={t}>
                      {titleCase(t)}
                    </option>
                  ))}
                </SelectField>
              </div>
              <div className="space-y-2">
                <span className="block text-[13px] font-medium text-fg">Testcases</span>
                {tests.map((t, i) => (
                  <div key={i} className="grid grid-cols-[1fr_1fr_auto_auto] items-center gap-2">
                    <input
                      placeholder="input (stdin)"
                      value={t.input}
                      onChange={(e) =>
                        setTests((cur) =>
                          cur.map((x, j) => (j === i ? { ...x, input: e.target.value } : x)),
                        )
                      }
                      className="rounded-md border border-line-strong bg-surface px-2 py-1.5 font-mono text-[12px] text-fg focus:border-accent focus:outline-none"
                    />
                    <input
                      placeholder="expected output"
                      value={t.expectedOutput}
                      onChange={(e) =>
                        setTests((cur) =>
                          cur.map((x, j) =>
                            j === i ? { ...x, expectedOutput: e.target.value } : x,
                          ),
                        )
                      }
                      className="rounded-md border border-line-strong bg-surface px-2 py-1.5 font-mono text-[12px] text-fg focus:border-accent focus:outline-none"
                    />
                    <label className="inline-flex items-center gap-1 text-[11px] text-muted">
                      <input
                        type="checkbox"
                        checked={t.isSample}
                        onChange={(e) =>
                          setTests((cur) =>
                            cur.map((x, j) => (j === i ? { ...x, isSample: e.target.checked } : x)),
                          )
                        }
                      />
                      sample
                    </label>
                    <button
                      type="button"
                      onClick={() => setTests((cur) => cur.filter((_, j) => j !== i))}
                      className="text-faint hover:text-danger"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() =>
                    setTests((cur) => [...cur, { input: '', expectedOutput: '', isSample: false }])
                  }
                  className="text-[12px] font-medium text-accent"
                >
                  + Add testcase
                </button>
              </div>
            </div>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={addQuestion}
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-fg px-3.5 py-2 text-[13px] font-medium text-bg hover:opacity-90 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" /> Add question
          </button>
        </div>
      ) : (
        <p className="text-[12px] text-muted">Questions are locked once the contest is live.</p>
      )}
    </Panel>
  );
}

function ModeTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors ${
        active ? 'bg-fg text-bg' : 'text-muted hover:bg-surface'
      }`}
    >
      {children}
    </button>
  );
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="mono-label text-[10px] text-faint">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium text-fg">{value ?? '—'}</dd>
    </div>
  );
}
