import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Play, CheckCircle2, Loader2, Send, Terminal, FlaskConical } from 'lucide-react';
import {
  isTerminalSubmissionStatus,
  LANGUAGE_META,
  PROGRAMMING_LANGUAGES,
  type EnqueueResponse,
  type ProgrammingLanguage,
  type QuestionDetail,
  type SubmissionDto,
  type SubmissionListRow,
} from '@code-nexus/types';
import { api, ApiError } from '../../lib/api.ts';
import {
  arenaKeys,
  isAccepted,
  starterCodeFor,
  timeAgo,
  VERDICT_LABELS,
  VERDICT_STYLES,
} from '../../lib/arena.ts';
import { clearDraft, draftKey, loadDraft, saveDraft, SUBMIT_SHORTCUT } from '../../lib/editor.ts';
import { AppShell } from '../../components/dashboard/AppShell.tsx';
import { DifficultyBadge } from '../../components/arena/DifficultyBadge.tsx';
import { EditorPane } from '../../components/arena/EditorPane.tsx';
import { ProblemStatement } from '../../components/arena/ProblemStatement.tsx';
import { ResultPanel } from '../../components/arena/ResultPanel.tsx';

/**
 * The practice workspace: statement on the left, editor and console on the
 * right, both sides resizable.
 *
 * Two things here are not decoration. The editor keeps a DRAFT of every language
 * you touch, so a reload — or a closed laptop, or a crashed tab — costs nothing;
 * and Run/Submit are on the keyboard, because reaching for a mouse between two
 * attempts is the friction that makes practice feel like admin.
 */

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  );
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setMatches(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [query]);
  return matches;
}

type LeftTab = 'description' | 'submissions';
type ConsoleTab = 'testcase' | 'result';

const PANEL =
  'flex min-h-0 flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-sm';

export function Workspace() {
  const { slug = '' } = useParams();
  const qc = useQueryClient();
  const isDesktop = useMediaQuery('(min-width: 1024px)');

  const questionQuery = useQuery({
    queryKey: arenaKeys.question(slug),
    queryFn: () => api.get<QuestionDetail>(`/arena/questions/${slug}`),
  });
  const question = questionQuery.data;

  const [language, setLanguage] = useState<ProgrammingLanguage>('PYTHON');
  const [codeByLang, setCodeByLang] = useState<Partial<Record<ProgrammingLanguage, string>>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const [leftTab, setLeftTab] = useState<LeftTab>('description');
  const [consoleTab, setConsoleTab] = useState<ConsoleTab>('testcase');
  const [caseIdx, setCaseIdx] = useState(0);
  const [zen, setZen] = useState(false);
  const [saved, setSaved] = useState(false);

  const [leftPct, setLeftPct] = useState(44);
  const [editorPct, setEditorPct] = useState(64);
  const rowRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);

  // ---- The buffer -----------------------------------------------------------
  // A language you have typed in before comes back as you left it; one you have
  // not opens on the problem's starter code.
  useEffect(() => {
    if (!question) return;
    setCodeByLang((m) => {
      if (m[language] !== undefined) return m;
      const draft = loadDraft(draftKey('arena', slug, language));
      return draft == null ? m : { ...m, [language]: draft };
    });
  }, [question, language, slug]);

  const code = codeByLang[language] ?? starterCodeFor(question, language);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setCode = useCallback(
    (v: string) => {
      setCodeByLang((m) => ({ ...m, [language]: v }));
      // Debounced: a keystroke is not worth a synchronous disk write, but no
      // keystroke should ever be more than a moment away from being safe.
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        saveDraft(draftKey('arena', slug, language), v);
        setSaved(true);
        setTimeout(() => setSaved(false), 1600);
      }, 500);
    },
    [language, slug],
  );
  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    [],
  );

  const resetCode = (): void => {
    clearDraft(draftKey('arena', slug, language));
    setCodeByLang((m) => ({ ...m, [language]: starterCodeFor(question, language) }));
  };

  // ---- Judging --------------------------------------------------------------
  const submissionQuery = useQuery({
    queryKey: activeId ? arenaKeys.submission(activeId) : ['arena', 'submission', 'none'],
    queryFn: () => api.get<SubmissionDto>(`/arena/submissions/${activeId}`),
    enabled: !!activeId,
    refetchInterval: (q) => {
      const s = q.state.data as SubmissionDto | undefined;
      return s && isTerminalSubmissionStatus(s.status) ? false : 800;
    },
  });
  const sub = submissionQuery.data;
  const pending = !!activeId && (!sub || !isTerminalSubmissionStatus(sub.status));

  const submissionsList = useQuery({
    queryKey: arenaKeys.submissions(slug),
    queryFn: () => api.get<{ submissions: SubmissionListRow[] }>(`/arena/submissions?slug=${slug}`),
    enabled: leftTab === 'submissions',
  });

  const trigger = useCallback(
    async (kind: 'run' | 'submit') => {
      setError(undefined);
      setActiveId(null);
      setConsoleTab('result');
      try {
        const res = await api.post<EnqueueResponse>(`/arena/questions/${slug}/${kind}`, {
          language,
          sourceCode: codeRef.current,
        });
        setActiveId(res.submissionPublicId);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'Could not submit');
      }
    },
    [slug, language],
  );
  // The keyboard shortcuts are registered once inside Monaco, so they must read
  // the live buffer rather than the one that existed when they were bound.
  const codeRef = useRef(code);
  codeRef.current = code;

  const terminalId = sub && isTerminalSubmissionStatus(sub.status) ? sub.publicId : null;
  useEffect(() => {
    if (!terminalId) return;
    void qc.invalidateQueries({ queryKey: arenaKeys.question(slug) });
    void qc.invalidateQueries({ queryKey: ['arena', 'questions'] });
    void qc.invalidateQueries({ queryKey: ['arena', 'heatmap'] });
    void qc.invalidateQueries({ queryKey: arenaKeys.stats });
    void qc.invalidateQueries({ queryKey: arenaKeys.submissions(slug) });
  }, [terminalId, qc, slug]);

  const startDrag = (axis: 'x' | 'y') => (e: React.PointerEvent) => {
    e.preventDefault();
    const move = (ev: PointerEvent) => {
      if (axis === 'x' && rowRef.current) {
        const r = rowRef.current.getBoundingClientRect();
        setLeftPct(Math.min(70, Math.max(28, ((ev.clientX - r.left) / r.width) * 100)));
      } else if (axis === 'y' && rightRef.current) {
        const r = rightRef.current.getBoundingClientRect();
        setEditorPct(Math.min(84, Math.max(28, ((ev.clientY - r.top) / r.height) * 100)));
      }
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    document.body.style.cursor = axis === 'x' ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
  };

  const samples = question?.sampleTestCases ?? [];
  const showLeft = !zen || !isDesktop;

  return (
    <AppShell title="Code Arena" fullBleed>
      <div className="flex h-full min-h-0 flex-col bg-bg-subtle lg:h-[calc(100vh-4rem)] lg:overflow-hidden">
        {/* Context bar */}
        <div className="flex h-12 shrink-0 items-center justify-between gap-3 px-4">
          <Link
            to="/app/arena"
            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[13px] font-medium text-muted transition-colors hover:bg-surface-2 hover:text-fg"
          >
            <ArrowLeft className="h-4 w-4" /> Problems
          </Link>
          {question ? (
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="truncate text-[13.5px] font-semibold text-fg">{question.title}</span>
              <DifficultyBadge difficulty={question.difficulty} />
              {question.status === 'solved' ? (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-success-line bg-success-soft px-2 py-0.5 text-[10px] font-medium text-success">
                  <CheckCircle2 className="h-3 w-3" /> Solved
                </span>
              ) : null}
            </div>
          ) : null}
          <div className="w-20" />
        </div>

        {questionQuery.isLoading ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading problem…
          </div>
        ) : questionQuery.isError ? (
          <div className="flex flex-1 items-center justify-center text-sm text-danger">
            Failed to load problem.
          </div>
        ) : question ? (
          <div
            ref={rowRef}
            className="flex min-h-0 flex-1 flex-col gap-2.5 px-2.5 pb-2.5 lg:flex-row lg:gap-0"
          >
            {/* LEFT — problem */}
            {showLeft ? (
              <div className={PANEL} style={isDesktop ? { width: `${leftPct}%` } : undefined}>
                <div className="flex h-11 shrink-0 items-center gap-1 border-b border-line px-2">
                  <TabButton
                    active={leftTab === 'description'}
                    onClick={() => setLeftTab('description')}
                  >
                    Description
                  </TabButton>
                  <TabButton
                    active={leftTab === 'submissions'}
                    onClick={() => setLeftTab('submissions')}
                  >
                    Submissions
                  </TabButton>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
                  {leftTab === 'description' ? (
                    <ProblemStatement question={question} />
                  ) : (
                    <SubmissionsView
                      rows={submissionsList.data?.submissions ?? []}
                      loading={submissionsList.isLoading}
                    />
                  )}
                </div>
              </div>
            ) : null}

            {showLeft ? <ResizeHandle axis="x" onPointerDown={startDrag('x')} /> : null}

            {/* RIGHT — editor + console */}
            <div ref={rightRef} className="flex min-h-0 flex-1 flex-col gap-2.5 lg:gap-0">
              <div
                className={PANEL}
                style={isDesktop ? { height: `${editorPct}%` } : { height: '56vh' }}
              >
                <EditorPane
                  language={language}
                  languages={PROGRAMMING_LANGUAGES}
                  onLanguageChange={setLanguage}
                  value={code}
                  onChange={setCode}
                  onRun={() => void trigger('run')}
                  onSubmit={() => void trigger('submit')}
                  onReset={resetCode}
                  expanded={zen}
                  onToggleExpand={isDesktop ? () => setZen((z) => !z) : undefined}
                  savedNote={saved ? 'Draft saved' : undefined}
                  actions={
                    <div className="ml-1 flex items-center gap-2">
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => void trigger('run')}
                        className="inline-flex items-center gap-1.5 rounded-md border border-line-strong bg-surface-2 px-3 py-1.5 text-[13px] font-medium text-fg transition-colors hover:bg-surface hover:shadow-sm disabled:opacity-50"
                      >
                        <Play className="h-3.5 w-3.5" /> Run
                      </button>
                      <button
                        type="button"
                        disabled={pending}
                        title={`Submit (${SUBMIT_SHORTCUT})`}
                        onClick={() => void trigger('submit')}
                        className="inline-flex items-center gap-1.5 rounded-md bg-success-solid px-3.5 py-1.5 text-[13px] font-semibold text-white shadow-sm transition-colors hover:opacity-90 disabled:opacity-50"
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

              <ResizeHandle axis="y" onPointerDown={startDrag('y')} />

              {/* console */}
              <div className={`${PANEL} min-h-[220px] flex-1`}>
                <div className="flex h-11 shrink-0 items-center gap-1 border-b border-line px-2.5">
                  <Terminal className="mr-1 h-4 w-4 text-faint" />
                  <TabButton
                    active={consoleTab === 'testcase'}
                    onClick={() => setConsoleTab('testcase')}
                  >
                    Testcase
                  </TabButton>
                  <TabButton
                    active={consoleTab === 'result'}
                    onClick={() => setConsoleTab('result')}
                  >
                    Result
                  </TabButton>
                  <div className="ml-auto">
                    <StatusPill pending={pending} sub={sub} error={error} />
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto p-4">
                  {consoleTab === 'testcase' ? (
                    <TestcaseView samples={samples} active={caseIdx} onPick={setCaseIdx} />
                  ) : (
                    <ResultPanel
                      sub={sub}
                      pending={pending}
                      error={error}
                      started={!!activeId}
                      emptyHint="Run to check the samples, or Submit to run every testcase."
                    />
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}

function ResizeHandle({
  axis,
  onPointerDown,
}: {
  axis: 'x' | 'y';
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  return (
    <div
      onPointerDown={onPointerDown}
      role="separator"
      aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
      className={`group hidden shrink-0 items-center justify-center lg:flex ${
        axis === 'x' ? 'w-2.5 cursor-col-resize' : 'h-2.5 cursor-row-resize'
      }`}
    >
      <div
        className={`rounded-full bg-line-strong/50 transition-colors group-hover:bg-accent ${
          axis === 'x' ? 'h-10 w-1' : 'h-1 w-10'
        }`}
      />
    </div>
  );
}

function TabButton({
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
      className={`rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors ${
        active ? 'bg-surface-2 text-fg' : 'text-muted hover:text-fg'
      }`}
    >
      {children}
    </button>
  );
}

function SubmissionsView({ rows, loading }: { rows: SubmissionListRow[]; loading: boolean }) {
  const submits = rows.filter((r) => r.kind === 'SUBMIT');
  if (loading) {
    return (
      <p className="inline-flex items-center gap-2 py-8 text-[13px] text-muted">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </p>
    );
  }
  if (submits.length === 0) {
    return (
      <p className="py-8 text-center text-[13px] text-muted">
        No submissions yet. Solve it and they will show up here.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-line">
      {submits.map((s) => {
        const done = s.status === 'DONE';
        return (
          <li key={s.publicId} className="flex items-center justify-between gap-3 py-2.5">
            <div className="flex min-w-0 items-center gap-2.5">
              {done && s.verdict ? (
                <span
                  className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${VERDICT_STYLES[s.verdict]}`}
                >
                  {VERDICT_LABELS[s.verdict]}
                </span>
              ) : (
                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface-2 px-2 py-0.5 text-[11px] text-muted">
                  <Loader2 className="h-3 w-3 animate-spin" />{' '}
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
              <span className="mono-label">{LANGUAGE_META[s.language].label}</span>
              <span title={new Date(s.createdAt).toLocaleString()}>{timeAgo(s.createdAt)}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The sample cases, one chip each. These are the cases Run is graded against —
 * Submit adds the hidden ones, which stay hidden.
 */
function TestcaseView({
  samples,
  active,
  onPick,
}: {
  samples: { input: string; expectedOutput: string }[];
  active: number;
  onPick: (i: number) => void;
}) {
  if (samples.length === 0) {
    return <p className="text-[13px] text-muted">This problem ships no sample testcase.</p>;
  }
  const t = samples[Math.min(active, samples.length - 1)]!;
  return (
    <div>
      {samples.length > 1 ? (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {samples.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onPick(i)}
              className={`rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors ${
                i === active
                  ? 'bg-surface-2 text-fg'
                  : 'text-muted hover:bg-surface-2 hover:text-fg'
              }`}
            >
              Case {i + 1}
            </button>
          ))}
        </div>
      ) : null}
      <div className="space-y-3 font-mono text-[12.5px]">
        <div>
          <p className="mono-label mb-1 text-[9px] text-faint">Input</p>
          <pre className="whitespace-pre-wrap rounded-lg bg-surface-2 p-3 text-fg">{t.input}</pre>
        </div>
        <div>
          <p className="mono-label mb-1 text-[9px] text-faint">Expected</p>
          <pre className="whitespace-pre-wrap rounded-lg bg-surface-2 p-3 text-fg">
            {t.expectedOutput}
          </pre>
        </div>
      </div>
      <p className="mt-3 inline-flex items-start gap-1.5 text-[12px] leading-relaxed text-faint">
        <FlaskConical className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        Run checks these samples. Submit runs every testcase, including hidden ones.
      </p>
    </div>
  );
}

function StatusPill({
  pending,
  sub,
  error,
}: {
  pending: boolean;
  sub?: SubmissionDto;
  error?: string;
}) {
  if (error) return <span className="text-[12px] font-medium text-danger">Error</span>;
  if (pending)
    return (
      <span className="inline-flex items-center gap-1.5 text-[12px] text-muted">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        {sub?.status === 'RUNNING' ? 'Running' : 'Queued'}
      </span>
    );
  if (sub && sub.status === 'DONE' && sub.verdict) {
    const ok = isAccepted(sub.verdict);
    return (
      <span className={`text-[12px] font-semibold ${ok ? 'text-success' : 'text-danger'}`}>
        {VERDICT_LABELS[sub.verdict]}
      </span>
    );
  }
  return null;
}
