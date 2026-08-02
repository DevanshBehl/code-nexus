import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Play,
  Send,
  CheckCircle2,
  Loader2,
  Trophy,
  Timer,
  Flag,
  Lock,
  ListChecks,
  Terminal,
} from 'lucide-react';
import {
  isTerminalSubmissionStatus,
  LANGUAGE_META,
  type ContestDetail,
  type ContestSubmissionRow,
  type ContestSubmissionsResponse,
  type EnqueueResponse,
  type ProgrammingLanguage,
  type QuestionDetail,
  type SubmissionDto,
} from '@code-nexus/types';
import { api, ApiError } from '../../lib/api.ts';
import {
  isAccepted,
  starterCodeFor,
  timeAgo,
  VERDICT_LABELS,
  VERDICT_STYLES,
} from '../../lib/arena.ts';
import { contestKeys, problemLetter } from '../../lib/contests.ts';
import { clearDraft, draftKey, loadDraft, saveDraft, SUBMIT_SHORTCUT } from '../../lib/editor.ts';
import { useExitGuard, useFullscreenLock } from '../../lib/roomLock.ts';
import { AppShell } from '../../components/dashboard/AppShell.tsx';
import { DifficultyBadge } from '../../components/arena/DifficultyBadge.tsx';
import { EditorPane } from '../../components/arena/EditorPane.tsx';
import { ProblemStatement } from '../../components/arena/ProblemStatement.tsx';
import { ResultPanel } from '../../components/arena/ResultPanel.tsx';
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
 * Inside, it reads like a round rather than a page of exercises. Problems are
 * LETTERS on a strip across the top, each carrying its own state — solved, tried,
 * untouched — so the standing question of a contest ("what have I got, and what
 * is left?") is answered at a glance instead of by clicking through. The verdict
 * history sits beside the statement, because in a timed round the last five
 * verdicts are context, not archaeology.
 *
 * Every keystroke is drafted to this browser. A contest is the worst possible
 * place to discover that a reload costs you forty minutes of work.
 *
 * Once there is no live attempt — submitted, expired, or never started — the page
 * is an ordinary one inside the app shell again.
 */

type SidePanel = 'statement' | 'submissions';

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

  const qs = useMemo(() => questions.data?.questions ?? [], [questions.data]);
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
  const [panel, setPanel] = useState<SidePanel>('statement');
  const [saved, setSaved] = useState(false);

  // Keep the language valid for this contest.
  useEffect(() => {
    if (allowed.length && !allowed.includes(language)) setLanguage(allowed[0]!);
  }, [allowed, language]);

  // ---- The buffer, per problem and language ---------------------------------
  const draftFor = useCallback(
    (slug: string, lang: ProgrammingLanguage) => draftKey(`contest:${publicId}`, slug, lang),
    [publicId],
  );

  useEffect(() => {
    if (!current) return;
    const slug = current.slug;
    setCodeMap((m) => {
      if (m[slug]?.[language] !== undefined) return m;
      const draft = loadDraft(draftFor(slug, language));
      if (draft == null) return m;
      return { ...m, [slug]: { ...(m[slug] ?? {}), [language]: draft } };
    });
  }, [current, language, draftFor]);

  const code = current
    ? (codeMap[current.slug]?.[language] ?? starterCodeFor(current, language))
    : '';
  const codeRef = useRef(code);
  codeRef.current = code;

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setCode = (v: string): void => {
    if (!current) return;
    const slug = current.slug;
    setCodeMap((m) => ({ ...m, [slug]: { ...(m[slug] ?? {}), [language]: v } }));
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveDraft(draftFor(slug, language), v);
      setSaved(true);
      setTimeout(() => setSaved(false), 1600);
    }, 500);
  };
  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    [],
  );

  const resetCode = (): void => {
    if (!current) return;
    clearDraft(draftFor(current.slug, language));
    setCodeMap((m) => ({
      ...m,
      [current.slug]: { ...(m[current.slug] ?? {}), [language]: starterCodeFor(current, language) },
    }));
  };

  // ---- Judging --------------------------------------------------------------
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

  const history = useQuery({
    queryKey: contestKeys.submissions(publicId),
    queryFn: () => api.get<ContestSubmissionsResponse>(`/contests/${publicId}/submissions`),
    enabled: !!contest.data?.startedAt,
  });

  const terminalId = sub && isTerminalSubmissionStatus(sub.status) ? sub.publicId : null;
  useEffect(() => {
    if (!terminalId) return;
    void qc.invalidateQueries({ queryKey: contestKeys.questions(publicId) });
    void qc.invalidateQueries({ queryKey: contestKeys.detail(publicId) });
    void qc.invalidateQueries({ queryKey: contestKeys.leaderboard(publicId) });
    void qc.invalidateQueries({ queryKey: contestKeys.submissions(publicId) });
  }, [terminalId, qc, publicId]);

  const trigger = useCallback(
    async (kind: 'run' | 'submit') => {
      const q = qs[idxRef.current];
      if (!q) return;
      setError(undefined);
      setActiveId(null);
      try {
        const res = await api.post<EnqueueResponse>(
          `/contests/${publicId}/questions/${q.slug}/${kind}`,
          { language, sourceCode: codeRef.current },
        );
        setActiveId(res.submissionPublicId);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'Could not submit');
      }
    },
    [publicId, language, qs],
  );
  // Monaco binds its shortcuts once; they must always act on the problem that is
  // open NOW, not the one that was open when the editor mounted.
  const idxRef = useRef(idx);
  idxRef.current = idx;

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

  const rows = useMemo(() => history.data?.submissions ?? [], [history.data]);
  const attemptsBySlug = useMemo(() => {
    const map = new Map<string, { tried: number; solved: boolean }>();
    for (const r of rows) {
      if (r.kind !== 'SUBMIT') continue;
      const cur = map.get(r.slug) ?? { tried: 0, solved: false };
      cur.tried += 1;
      cur.solved = cur.solved || isAccepted(r.verdict);
      map.set(r.slug, cur);
    }
    return map;
  }, [rows]);

  const solvedCount = qs.filter(
    (q) => q.status === 'solved' || attemptsBySlug.get(q.slug)?.solved,
  ).length;

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
            className="inline-flex shrink-0 items-center gap-1.5 text-[13px] font-medium text-muted"
          >
            <Lock className="h-3.5 w-3.5" /> Attempt locked
          </span>
        ) : (
          <Link
            to={`/app/contests/${publicId}`}
            className="inline-flex shrink-0 items-center gap-1.5 text-[13px] text-muted hover:text-fg"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </Link>
        )}
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="truncate text-[13px] font-semibold text-fg">{c?.title}</span>
          {qs.length > 0 ? (
            <span className="shrink-0 rounded-full border border-line bg-surface-2 px-2 py-0.5 text-[11px] tabular-nums text-muted">
              {solvedCount}/{qs.length} solved
            </span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {attemptActive && c?.attemptEndsAt ? (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-success-line bg-success-soft px-2.5 py-1 text-[12px] font-medium tabular-nums text-success">
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
          {/* Problems + statement */}
          <div className="flex min-h-0 flex-col border-line lg:w-[44%] lg:border-r">
            {/* The letter strip — a contest's table of contents. */}
            <div className="flex h-11 shrink-0 items-center gap-1 overflow-x-auto border-b border-line bg-surface px-2">
              {qs.map((q, i) => {
                const attempt = attemptsBySlug.get(q.slug);
                const solved = q.status === 'solved' || attempt?.solved;
                const tried = !solved && !!attempt?.tried;
                return (
                  <button
                    key={q.slug}
                    type="button"
                    title={q.title}
                    onClick={() => {
                      setIdx(i);
                      setActiveId(null);
                      setPanel('statement');
                    }}
                    className={`flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] font-semibold transition-colors ${
                      i === idx
                        ? 'bg-surface-2 text-fg'
                        : solved
                          ? 'text-success hover:bg-surface-2'
                          : tried
                            ? 'text-warn hover:bg-surface-2'
                            : 'text-muted hover:bg-surface-2 hover:text-fg'
                    }`}
                  >
                    {solved ? <CheckCircle2 className="h-3.5 w-3.5 text-success" /> : null}
                    {problemLetter(i)}
                  </button>
                );
              })}
              <div className="ml-auto flex shrink-0 items-center gap-1 pl-2">
                <PanelTab active={panel === 'statement'} onClick={() => setPanel('statement')}>
                  Problem
                </PanelTab>
                <PanelTab active={panel === 'submissions'} onClick={() => setPanel('submissions')}>
                  <span className="inline-flex items-center gap-1.5">
                    <ListChecks className="h-3.5 w-3.5" />
                    {rows.filter((r) => r.kind === 'SUBMIT').length || ''}
                  </span>
                </PanelTab>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto bg-bg px-5 py-5">
              {panel === 'submissions' ? (
                <ContestSubmissions rows={rows} qs={qs} onOpen={(i) => setIdx(i)} />
              ) : current ? (
                <ProblemStatement question={current} label={problemLetter(idx)} />
              ) : (
                <p className="text-[13px] text-muted">No questions.</p>
              )}
            </div>
          </div>

          {/* Editor + console */}
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex min-h-0 flex-1 flex-col" style={{ minHeight: '55vh' }}>
              <EditorPane
                language={language}
                languages={allowed}
                onLanguageChange={setLanguage}
                value={code}
                onChange={setCode}
                onRun={() => void trigger('run')}
                onSubmit={() => void trigger('submit')}
                onReset={current ? resetCode : undefined}
                label={
                  current
                    ? `${problemLetter(idx)} · ${LANGUAGE_META[language].filename}`
                    : undefined
                }
                savedNote={saved ? 'Draft saved' : undefined}
                actions={
                  <div className="ml-1 flex items-center gap-2">
                    <button
                      type="button"
                      disabled={pending || !current}
                      onClick={() => void trigger('run')}
                      className="inline-flex items-center gap-1.5 rounded-md border border-line-strong bg-surface-2 px-3 py-1.5 text-[13px] font-medium text-fg hover:bg-surface disabled:opacity-50"
                    >
                      <Play className="h-3.5 w-3.5" /> Run
                    </button>
                    <button
                      type="button"
                      disabled={pending || !current}
                      title={`Submit (${SUBMIT_SHORTCUT})`}
                      onClick={() => void trigger('submit')}
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
                }
              />
            </div>

            <div className="flex min-h-[190px] shrink-0 flex-col border-t border-line bg-bg">
              <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line px-4">
                <Terminal className="h-3.5 w-3.5 text-faint" />
                <span className="mono-label text-[10px] text-faint">Result</span>
                {current ? (
                  <span className="ml-auto flex items-center gap-2 text-[11px] text-faint">
                    <span className="font-semibold text-muted">{problemLetter(idx)}</span>
                    <span className="truncate">{current.title}</span>
                    <DifficultyBadge difficulty={current.difficulty} />
                  </span>
                ) : null}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                <ResultPanel
                  sub={sub}
                  pending={pending}
                  error={error}
                  started={!!activeId}
                  emptyHint="Run against the samples, or Submit to be judged on every testcase."
                />
              </div>
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

function PanelTab({
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
      className={`rounded-md px-2.5 py-1.5 text-[12px] font-medium transition-colors ${
        active ? 'bg-surface-2 text-fg' : 'text-muted hover:text-fg'
      }`}
    >
      {children}
    </button>
  );
}

/**
 * The attempt's verdict history, newest first — the panel a contestant checks
 * between submissions to remember what they have already tried.
 */
function ContestSubmissions({
  rows,
  qs,
  onOpen,
}: {
  rows: ContestSubmissionRow[];
  qs: QuestionDetail[];
  onOpen: (index: number) => void;
}) {
  const submits = rows.filter((r) => r.kind === 'SUBMIT');
  const indexOf = (slug: string): number => qs.findIndex((q) => q.slug === slug);

  if (submits.length === 0) {
    return (
      <p className="py-8 text-center text-[13px] text-muted">
        Nothing submitted yet. Every submission you make in this contest is listed here with its
        verdict.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-line">
      {submits.map((s) => {
        const i = indexOf(s.slug);
        const done = s.status === 'DONE';
        return (
          <li key={s.publicId} className="flex items-center justify-between gap-3 py-2.5">
            <div className="flex min-w-0 items-center gap-2.5">
              <button
                type="button"
                onClick={() => i >= 0 && onOpen(i)}
                className="shrink-0 rounded-md border border-line bg-surface-2 px-2 py-0.5 text-[12px] font-semibold text-fg hover:border-accent hover:text-accent"
              >
                {i >= 0 ? problemLetter(i) : '?'}
              </button>
              {done && s.verdict ? (
                <span
                  className={`truncate rounded-full border px-2 py-0.5 text-[11px] font-medium ${VERDICT_STYLES[s.verdict]}`}
                >
                  {VERDICT_LABELS[s.verdict]}
                </span>
              ) : (
                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface-2 px-2 py-0.5 text-[11px] text-muted">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {s.status === 'RUNNING' ? 'Running' : 'Queued'}
                </span>
              )}
              {done ? (
                <span className="shrink-0 text-[12px] tabular-nums text-faint">
                  {s.testsPassed}/{s.testsTotal}
                </span>
              ) : null}
            </div>
            <span className="flex shrink-0 items-center gap-3 text-[12px] text-faint">
              <span className="mono-label hidden sm:inline">{LANGUAGE_META[s.language].label}</span>
              <span title={new Date(s.createdAt).toLocaleString()}>{timeAgo(s.createdAt)}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
