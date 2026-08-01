import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Play,
  CheckCircle2,
  XCircle,
  Loader2,
  RotateCcw,
  Cpu,
  Clock,
  FileCode2,
  Terminal,
} from 'lucide-react';
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
import { arenaKeys, isAccepted, STARTER_TEMPLATES, VERDICT_LABELS } from '../../lib/arena.ts';
import { AppShell } from '../../components/dashboard/AppShell.tsx';
import { CodeEditor } from '../../components/arena/CodeEditor.tsx';
import { DifficultyBadge } from '../../components/arena/DifficultyBadge.tsx';

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

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

  const [leftPct, setLeftPct] = useState(44);
  const [editorPct, setEditorPct] = useState(64);
  const rowRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);

  const code = useMemo(() => {
    if (codeByLang[language] !== undefined) return codeByLang[language]!;
    return question?.starterCode?.[language] ?? STARTER_TEMPLATES[language];
  }, [codeByLang, language, question]);
  const setCode = (v: string) => setCodeByLang((m) => ({ ...m, [language]: v }));
  const resetCode = () =>
    setCodeByLang((m) => ({
      ...m,
      [language]: question?.starterCode?.[language] ?? STARTER_TEMPLATES[language],
    }));

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

  const trigger = async (kind: 'run' | 'submit') => {
    setError(undefined);
    setActiveId(null);
    setConsoleTab('result');
    try {
      const res = await api.post<EnqueueResponse>(`/arena/questions/${slug}/${kind}`, {
        language,
        sourceCode: code,
      });
      setActiveId(res.submissionPublicId);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not submit');
    }
  };

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

  return (
    <AppShell title="Code Arena" fullBleed>
      <div className="flex h-full min-h-0 flex-col bg-bg-subtle lg:h-[calc(100vh-4rem)] lg:overflow-hidden">
        {/* Context bar */}
        <div className="flex h-12 shrink-0 items-center justify-between px-4">
          <Link
            to="/app/arena"
            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[13px] font-medium text-muted transition-colors hover:bg-surface-2 hover:text-fg"
          >
            <ArrowLeft className="h-4 w-4" /> Problems
          </Link>
          {question ? (
            <div className="flex items-center gap-2.5">
              <span className="truncate text-[13.5px] font-semibold text-fg">{question.title}</span>
              <DifficultyBadge difficulty={question.difficulty} />
              {question.status === 'solved' ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-success-line bg-success-soft px-2 py-0.5 text-[10px] font-medium text-success">
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
                  <ProblemView question={question} />
                ) : (
                  <SubmissionsView rows={submissionsList.data?.submissions ?? []} />
                )}
              </div>
            </div>

            <ResizeHandle axis="x" onPointerDown={startDrag('x')} />

            {/* RIGHT — editor + console */}
            <div ref={rightRef} className="flex min-h-0 flex-1 flex-col gap-2.5 lg:gap-0">
              {/* editor */}
              <div
                className={PANEL}
                style={isDesktop ? { height: `${editorPct}%` } : { height: '56vh' }}
              >
                <div className="flex h-11 shrink-0 items-center justify-between border-b border-line px-2.5">
                  <div className="flex items-center gap-2">
                    <FileCode2 className="h-4 w-4 text-faint" />
                    <select
                      aria-label="Language"
                      value={language}
                      onChange={(e) => setLanguage(e.target.value as ProgrammingLanguage)}
                      className="rounded-md border border-line-strong bg-surface-2 px-2.5 py-1 text-[12px] font-medium text-fg transition-colors hover:bg-surface focus:border-accent focus:outline-none"
                    >
                      {PROGRAMMING_LANGUAGES.map((l) => (
                        <option key={l} value={l}>
                          {LANGUAGE_META[l].label}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={resetCode}
                      title="Reset to starter code"
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-faint transition-colors hover:bg-surface-2 hover:text-fg"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => trigger('run')}
                      className="inline-flex items-center gap-1.5 rounded-md border border-line-strong bg-surface-2 px-3 py-1.5 text-[13px] font-medium text-fg transition-colors hover:bg-surface hover:shadow-sm disabled:opacity-50"
                    >
                      <Play className="h-3.5 w-3.5" /> Run
                    </button>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => trigger('submit')}
                      className="inline-flex items-center gap-1.5 rounded-md bg-success-solid px-3.5 py-1.5 text-[13px] font-semibold text-white shadow-sm transition-colors hover:opacity-90 disabled:opacity-50"
                    >
                      {pending ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      )}
                      Submit
                    </button>
                  </div>
                </div>
                <div className="min-h-0 flex-1">
                  <CodeEditor language={language} value={code} onChange={setCode} />
                </div>
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
                    <TestcaseView question={question} />
                  ) : (
                    <ResultView pending={pending} sub={sub} error={error} activeId={activeId} />
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

function ProblemView({ question }: { question: QuestionDetail }) {
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="text-[19px] font-semibold tracking-tight text-fg">{question.title}</h1>
        <DifficultyBadge difficulty={question.difficulty} />
        <span className="mono-label rounded-full border border-line px-2 py-0.5 text-[9px] text-faint">
          {titleCase(question.topic)}
        </span>
      </div>
      <div className="whitespace-pre-wrap text-[13.5px] leading-[1.7] text-fg/90">
        {question.description}
      </div>
      {question.constraints ? (
        <div className="mt-5">
          <p className="mb-1.5 text-[13px] font-semibold text-fg">Constraints</p>
          <p className="whitespace-pre-wrap rounded-lg bg-surface-2 px-3 py-2 font-mono text-[12.5px] text-muted">
            {question.constraints}
          </p>
        </div>
      ) : null}
      <div className="mt-6 space-y-5">
        {question.sampleTestCases.map((t, i) => (
          <div key={i}>
            <p className="mb-2 text-[13px] font-semibold text-fg">Example {i + 1}</p>
            <div className="space-y-2.5 rounded-xl border border-line bg-surface-2 p-3.5 font-mono text-[12.5px]">
              <div>
                <span className="mono-label text-[9px] text-faint">Input</span>
                <pre className="mt-1 whitespace-pre-wrap text-fg">{t.input}</pre>
              </div>
              <div className="border-t border-line pt-2.5">
                <span className="mono-label text-[9px] text-faint">Output</span>
                <pre className="mt-1 whitespace-pre-wrap text-fg">{t.expectedOutput}</pre>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SubmissionsView({ rows }: { rows: SubmissionListRow[] }) {
  const submits = rows.filter((r) => r.kind === 'SUBMIT');
  if (submits.length === 0) {
    return <p className="py-8 text-center text-[13px] text-muted">No submissions yet.</p>;
  }
  return (
    <ul className="divide-y divide-line">
      {submits.map((s) => {
        const done = s.status === 'DONE';
        const ok = isAccepted(s.verdict);
        return (
          <li key={s.publicId} className="flex items-center justify-between gap-3 py-2.5">
            <span
              className={`text-[13px] font-medium ${
                !done ? 'text-muted' : ok ? 'text-success' : 'text-danger'
              }`}
            >
              {!done ? titleCase(s.status) : s.verdict ? VERDICT_LABELS[s.verdict] : '—'}
            </span>
            <span className="flex items-center gap-3 text-[12px] text-faint">
              <span className="mono-label">{LANGUAGE_META[s.language].label}</span>
              <span>{new Date(s.createdAt).toLocaleString()}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function TestcaseView({ question }: { question: QuestionDetail }) {
  if (question.sampleTestCases.length === 0) {
    return <p className="text-[13px] text-muted">No sample testcase.</p>;
  }
  const t = question.sampleTestCases[0]!;
  return (
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
      <p className="pt-1 font-sans text-[12px] text-faint">
        Run tests against this sample, or Submit to run every testcase.
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

function ResultView({
  pending,
  sub,
  error,
  activeId,
}: {
  pending: boolean;
  sub?: SubmissionDto;
  error?: string;
  activeId: string | null;
}) {
  if (error) {
    return (
      <p className="rounded-lg border border-danger-line bg-danger-soft px-3 py-2 text-[13px] text-danger">
        {error}
      </p>
    );
  }
  if (!activeId) {
    return (
      <p className="flex items-center gap-2 text-[13px] text-muted">
        <Terminal className="h-4 w-4 text-faint" /> Run or Submit to see results here.
      </p>
    );
  }
  if (pending) {
    return (
      <p className="inline-flex items-center gap-2 text-[13px] text-muted">
        <Loader2 className="h-4 w-4 animate-spin" />
        {sub?.status === 'RUNNING' ? 'Running your code…' : 'Queued…'}
      </p>
    );
  }
  if (!sub) return null;
  if (sub.status === 'ERROR') {
    return (
      <p className="inline-flex items-center gap-2 text-[13px] text-danger">
        <XCircle className="h-4 w-4" /> Execution failed — the judge may be unavailable. Try again.
      </p>
    );
  }

  const ok = isAccepted(sub.verdict);
  return (
    <div className="space-y-4">
      <div
        className={`flex flex-wrap items-center gap-3 rounded-lg border px-3.5 py-2.5 ${
          ok ? 'border-success-line bg-success-soft' : 'border-danger-line bg-danger-soft'
        }`}
      >
        <span
          className={`inline-flex items-center gap-2 text-[15px] font-semibold ${
            ok ? 'text-success' : 'text-danger'
          }`}
        >
          {ok ? <CheckCircle2 className="h-5 w-5" /> : <XCircle className="h-5 w-5" />}
          {sub.verdict ? VERDICT_LABELS[sub.verdict] : '—'}
        </span>
        <span className="text-[13px] text-muted">
          {sub.testsPassed}/{sub.testsTotal} testcases
          {!ok && sub.failedTestIndex ? ` · failed on test ${sub.failedTestIndex}` : ''}
        </span>
        <span className="ml-auto flex flex-wrap gap-3 text-[12px] text-faint">
          {sub.runtimeMs != null ? (
            <span className="inline-flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" /> {sub.runtimeMs} ms
            </span>
          ) : null}
          {sub.memoryKb != null ? (
            <span className="inline-flex items-center gap-1.5">
              <Cpu className="h-3.5 w-3.5" /> {Math.round(sub.memoryKb / 1024)} MB
            </span>
          ) : null}
        </span>
      </div>

      {sub.kind === 'RUN' && sub.compileOutput ? (
        <OutputBlock label="Compiler output" tone="error" value={sub.compileOutput} />
      ) : null}
      {sub.kind === 'RUN' && sub.stdout != null ? (
        <OutputBlock label="Your output" value={sub.stdout || '(no output)'} />
      ) : null}
      {sub.kind === 'RUN' && sub.stderr ? (
        <OutputBlock label="Stderr" tone="warn" value={sub.stderr} />
      ) : null}
    </div>
  );
}

function OutputBlock({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'error' | 'warn';
}) {
  const color = tone === 'error' ? 'text-danger' : tone === 'warn' ? 'text-warn' : 'text-fg';
  return (
    <div>
      <p className="mono-label mb-1 text-[9px] text-faint">{label}</p>
      <pre
        className={`whitespace-pre-wrap rounded-lg bg-surface-2 p-3 font-mono text-[12.5px] ${color}`}
      >
        {value}
      </pre>
    </div>
  );
}
