import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Play,
  Send,
  CheckCircle2,
  XCircle,
  Loader2,
  Trophy,
  Timer,
  Flag,
  Lock,
} from 'lucide-react';
import {
  isTerminalSubmissionStatus,
  LANGUAGE_META,
  type ContestDetail,
  type EnqueueResponse,
  type ProgrammingLanguage,
  type QuestionDetail,
  type SubmissionDto,
} from '@code-nexus/types';
import { api, ApiError } from '../../lib/api.ts';
import { STARTER_TEMPLATES, VERDICT_LABELS, isAccepted } from '../../lib/arena.ts';
import { contestKeys } from '../../lib/contests.ts';
import { useExitGuard, useFullscreenLock } from '../../lib/roomLock.ts';
import { AppShell } from '../../components/dashboard/AppShell.tsx';
import { CodeEditor } from '../../components/arena/CodeEditor.tsx';
import { DifficultyBadge } from '../../components/arena/DifficultyBadge.tsx';
import { FullscreenGate } from '../../components/rooms/FullscreenGate.tsx';
import { Countdown } from '../../components/contests/ContestBits.tsx';

type CodeMap = Record<string, Partial<Record<ProgrammingLanguage, string>>>;

/**
 * The contest arena. While an attempt is running this is a LOCKED room, exactly
 * like a live interview: it takes over the viewport in fullscreen, drops the app
 * shell so there is no sidebar to slip out through, and swallows Back. The only
 * way out is Finish & submit (or the clock running out), because an attempt you
 * can wander away from and come back to is not a timed attempt.
 *
 * Once there is no live attempt — submitted, expired, or never started — the page
 * is an ordinary one inside the app shell again.
 */

export function ContestArena() {
  const { publicId = '' } = useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const contest = useQuery({
    queryKey: contestKeys.detail(publicId),
    queryFn: () => api.get<ContestDetail>(`/contests/${publicId}`),
  });
  const questions = useQuery({
    queryKey: contestKeys.questions(publicId),
    queryFn: () => api.get<{ questions: QuestionDetail[] }>(`/contests/${publicId}/questions`),
    enabled: !!contest.data?.startedAt || contest.data?.phase === 'ended',
  });

  // Set the instant we start a sanctioned exit, so the guard stands down for the
  // navigation that follows instead of trapping our own redirect.
  const [exiting, setExiting] = useState(false);
  const toLeaderboard = useCallback(() => {
    setExiting(true);
    navigate(`/app/contests/${publicId}/leaderboard`);
  }, [navigate, publicId]);

  const finish = useMutation({
    mutationFn: () => api.post(`/contests/${publicId}/finish`),
    onSuccess: toLeaderboard,
  });

  const qs = questions.data?.questions ?? [];
  const [idx, setIdx] = useState(0);
  const current = qs[idx];
  const allowed = useMemo<ProgrammingLanguage[]>(
    () => contest.data?.allowedLanguages ?? ['PYTHON'],
    [contest.data],
  );

  const [language, setLanguage] = useState<ProgrammingLanguage>('PYTHON');
  const [codeMap, setCodeMap] = useState<CodeMap>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState<string>();

  // Keep the language valid for this contest.
  useEffect(() => {
    if (allowed.length && !allowed.includes(language)) setLanguage(allowed[0]!);
  }, [allowed, language]);

  const code = useMemo(() => {
    if (!current) return '';
    const byLang = codeMap[current.slug] ?? {};
    return byLang[language] ?? current.starterCode?.[language] ?? STARTER_TEMPLATES[language];
  }, [codeMap, current, language]);

  const setCode = (v: string) => {
    if (!current) return;
    setCodeMap((m) => ({ ...m, [current.slug]: { ...(m[current.slug] ?? {}), [language]: v } }));
  };

  const submissionQuery = useQuery({
    queryKey: activeId ? contestKeys.submission(activeId) : ['arena', 'submission', 'none'],
    queryFn: () => api.get<SubmissionDto>(`/arena/submissions/${activeId}`),
    enabled: !!activeId,
    refetchInterval: (q) => {
      const s = q.state.data as SubmissionDto | undefined;
      return s && isTerminalSubmissionStatus(s.status) ? false : 800;
    },
  });
  const sub = submissionQuery.data;
  const pending = !!activeId && (!sub || !isTerminalSubmissionStatus(sub.status));

  const terminalId = sub && isTerminalSubmissionStatus(sub.status) ? sub.publicId : null;
  useEffect(() => {
    if (!terminalId) return;
    void qc.invalidateQueries({ queryKey: contestKeys.questions(publicId) });
    void qc.invalidateQueries({ queryKey: contestKeys.detail(publicId) });
    void qc.invalidateQueries({ queryKey: contestKeys.leaderboard(publicId) });
  }, [terminalId, qc, publicId]);

  const trigger = async (kind: 'run' | 'submit') => {
    if (!current) return;
    setError(undefined);
    setActiveId(null);
    try {
      const res = await api.post<EnqueueResponse>(
        `/contests/${publicId}/questions/${current.slug}/${kind}`,
        { language, sourceCode: code },
      );
      setActiveId(res.submissionPublicId);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not submit');
    }
  };

  const c = contest.data;
  const attemptActive =
    !!c?.startedAt &&
    !c?.submittedAt &&
    !!c?.attemptEndsAt &&
    new Date(c.attemptEndsAt).getTime() > Date.now();
  const noAttempt = !!c && !attemptActive;

  // ---- Room lock ------------------------------------------------------------
  const locked = attemptActive && !exiting;
  const [blocked, setBlocked] = useState<string | null>(null);
  useEffect(() => {
    if (!blocked) return;
    const t = setTimeout(() => setBlocked(null), 4000);
    return () => clearTimeout(t);
  }, [blocked]);
  useExitGuard(locked, () =>
    setBlocked('Your attempt is still running — use Finish & submit to leave.'),
  );
  const fullscreen = useFullscreenLock(locked);

  const body = (
    <div
      className={`flex min-h-0 flex-col bg-bg-subtle ${
        locked ? 'h-full overflow-hidden' : 'h-full lg:h-[calc(100vh-4rem)] lg:overflow-hidden'
      }`}
    >
      {/* Contest bar */}
      <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-line bg-surface px-4">
        {locked ? (
          <span
            title="You cannot leave a running attempt — use Finish & submit"
            className="inline-flex items-center gap-1.5 text-[13px] font-medium text-muted"
          >
            <Lock className="h-3.5 w-3.5" /> Attempt locked
          </span>
        ) : (
          <Link
            to={`/app/contests/${publicId}`}
            className="inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-fg"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </Link>
        )}
        <div className="flex items-center gap-2 truncate text-[13px] font-semibold text-fg">
          {c?.title}
        </div>
        <div className="flex items-center gap-3">
          {attemptActive && c?.attemptEndsAt ? (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-success-line bg-success-soft px-2.5 py-1 text-[12px] font-medium text-success">
              <Timer className="h-3.5 w-3.5" />
              <Countdown target={c.attemptEndsAt} onElapsed={toLeaderboard} />
            </span>
          ) : null}
          {/* Standings are a way out of the room, so they wait until the
                attempt is over. */}
          {locked ? null : (
            <Link
              to={`/app/contests/${publicId}/leaderboard`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line-strong px-3 py-1.5 text-[13px] font-medium text-fg hover:bg-surface-2"
            >
              <Trophy className="h-3.5 w-3.5" /> Leaderboard
            </Link>
          )}
          {attemptActive ? (
            <button
              type="button"
              disabled={finish.isPending}
              onClick={() => {
                if (confirm('Finish and submit your contest? You cannot re-enter afterward.')) {
                  finish.mutate();
                }
              }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-success-solid px-3.5 py-1.5 text-[13px] font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              <Flag className="h-3.5 w-3.5" /> Finish &amp; submit
            </button>
          ) : null}
        </div>
      </div>

      {blocked ? (
        <div
          role="status"
          className="shrink-0 bg-warn-soft px-4 py-2 text-center text-[12px] text-warn"
        >
          {blocked}
        </div>
      ) : null}

      {noAttempt ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <p className="text-sm text-muted">
            {c?.submittedAt
              ? 'You have already submitted this contest.'
              : c?.startedAt
                ? 'Your attempt window has ended.'
                : 'Start the contest from its page to begin your attempt.'}
          </p>
          <Link to={`/app/contests/${publicId}`} className="text-[13px] font-medium text-accent">
            Back to contest
          </Link>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          {/* Problem switcher + statement */}
          <div className="flex min-h-0 flex-col border-line lg:w-[42%] lg:border-r">
            <div className="flex h-11 shrink-0 items-center gap-1 overflow-x-auto border-b border-line bg-surface px-2">
              {qs.map((q, i) => (
                <button
                  key={q.slug}
                  type="button"
                  onClick={() => {
                    setIdx(i);
                    setActiveId(null);
                  }}
                  className={`flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors ${
                    i === idx ? 'bg-surface-2 text-fg' : 'text-muted hover:text-fg'
                  }`}
                >
                  {q.status === 'solved' ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                  ) : null}
                  Q{i + 1}
                </button>
              ))}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto bg-bg px-5 py-5">
              {current ? (
                <div>
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <h1 className="text-[18px] font-semibold tracking-tight text-fg">
                      {current.title}
                    </h1>
                    <DifficultyBadge difficulty={current.difficulty} />
                  </div>
                  <div className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-fg/90">
                    {current.description}
                  </div>
                  {current.constraints ? (
                    <p className="mt-4 whitespace-pre-wrap rounded-lg bg-surface-2 px-3 py-2 font-mono text-[12.5px] text-muted">
                      {current.constraints}
                    </p>
                  ) : null}
                  <div className="mt-5 space-y-4">
                    {current.sampleTestCases.map((t, i) => (
                      <div
                        key={i}
                        className="rounded-xl border border-line bg-surface-2 p-3.5 font-mono text-[12.5px]"
                      >
                        <p className="mono-label text-[9px] text-faint">Input</p>
                        <pre className="mb-2 mt-1 whitespace-pre-wrap text-fg">{t.input}</pre>
                        <p className="mono-label text-[9px] text-faint">Output</p>
                        <pre className="mt-1 whitespace-pre-wrap text-fg">{t.expectedOutput}</pre>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-[13px] text-muted">No questions.</p>
              )}
            </div>
          </div>

          {/* Editor + console */}
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex min-h-0 flex-1 flex-col" style={{ minHeight: '55vh' }}>
              <div className="flex h-11 shrink-0 items-center justify-between border-b border-line bg-surface px-2.5">
                <select
                  aria-label="Language"
                  value={language}
                  onChange={(e) => setLanguage(e.target.value as ProgrammingLanguage)}
                  className="rounded-md border border-line-strong bg-surface-2 px-2.5 py-1 text-[12px] font-medium text-fg focus:border-accent focus:outline-none"
                >
                  {allowed.map((l) => (
                    <option key={l} value={l}>
                      {LANGUAGE_META[l].label}
                    </option>
                  ))}
                </select>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={pending || !current}
                    onClick={() => trigger('run')}
                    className="inline-flex items-center gap-1.5 rounded-md border border-line-strong bg-surface-2 px-3 py-1.5 text-[13px] font-medium text-fg hover:bg-surface disabled:opacity-50"
                  >
                    <Play className="h-3.5 w-3.5" /> Run
                  </button>
                  <button
                    type="button"
                    disabled={pending || !current}
                    onClick={() => trigger('submit')}
                    className="inline-flex items-center gap-1.5 rounded-md bg-success-solid px-3.5 py-1.5 text-[13px] font-semibold text-white hover:opacity-90 disabled:opacity-50"
                  >
                    {pending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Send className="h-3.5 w-3.5" />
                    )}
                    Submit
                  </button>
                </div>
              </div>
              <div className="min-h-0 flex-1">
                {current ? (
                  <CodeEditor language={language} value={code} onChange={setCode} />
                ) : null}
              </div>
            </div>

            <div className="min-h-[180px] shrink-0 border-t border-line bg-bg p-4">
              <p className="mono-label mb-2 text-[10px] text-faint">Result</p>
              {error ? (
                <p className="rounded-lg border border-danger-line bg-danger-soft px-3 py-2 text-[13px] text-danger">
                  {error}
                </p>
              ) : !activeId ? (
                <p className="text-[13px] text-muted">
                  Run against the sample, or Submit against all testcases.
                </p>
              ) : pending ? (
                <p className="inline-flex items-center gap-2 text-[13px] text-muted">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {sub?.status === 'RUNNING' ? 'Running…' : 'Queued…'}
                </p>
              ) : sub ? (
                <ContestResult sub={sub} />
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );

  if (locked) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-bg-subtle">
        {body}
        <FullscreenGate
          open={!fullscreen.held}
          onEnter={fullscreen.request}
          refused={fullscreen.refused}
          title="This contest runs fullscreen"
          detail="Your attempt needs the whole screen. The clock is still running — enter fullscreen to get back to your questions."
        />
      </div>
    );
  }

  return (
    <AppShell title="Contest" fullBleed>
      {body}
    </AppShell>
  );
}

function ContestResult({ sub }: { sub: SubmissionDto }) {
  if (sub.status === 'ERROR') {
    return (
      <p className="inline-flex items-center gap-2 text-[13px] text-danger">
        <XCircle className="h-4 w-4" /> Execution failed — try again.
      </p>
    );
  }
  const ok = isAccepted(sub.verdict);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={`inline-flex items-center gap-2 text-sm font-semibold ${ok ? 'text-success' : 'text-danger'}`}
        >
          {ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
          {sub.verdict ? VERDICT_LABELS[sub.verdict] : '—'}
        </span>
        <span className="text-[13px] text-muted">
          {sub.testsPassed}/{sub.testsTotal} testcases
          {!ok && sub.failedTestIndex ? ` · failed on test ${sub.failedTestIndex}` : ''}
        </span>
      </div>
      {sub.kind === 'RUN' && sub.stdout != null ? (
        <div>
          <p className="mono-label mb-1 text-[9px] text-faint">Your output</p>
          <pre className="whitespace-pre-wrap rounded-lg bg-surface-2 p-2.5 font-mono text-[12.5px] text-fg">
            {sub.stdout || '(no output)'}
          </pre>
        </div>
      ) : null}
    </div>
  );
}
