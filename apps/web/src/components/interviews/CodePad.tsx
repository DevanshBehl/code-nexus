import { Eye, Play } from 'lucide-react';
import { PROGRAMMING_LANGUAGES, LANGUAGE_META, type ProgrammingLanguage } from '@code-nexus/types';
import { CodeEditor } from '../arena/CodeEditor.tsx';

/**
 * The shared code editor for the interview room. Value + language are controlled
 * by the parent (synced across peers via the gateway).
 *
 * The IDE is ASYMMETRIC on purpose: only the candidate types. Interviewers get the
 * same document streaming in live but read-only, so they watch the candidate work
 * without being able to nudge the code. "Run" (candidate only) reuses the Phase-6
 * execution pipeline.
 */
export function CodePad({
  language,
  onLanguageChange,
  value,
  onChange,
  onRun,
  running,
  canRun,
  result,
  readOnly = false,
  authorName,
}: {
  language: ProgrammingLanguage;
  onLanguageChange: (l: ProgrammingLanguage) => void;
  value: string;
  onChange: (v: string) => void;
  onRun?: () => void;
  running?: boolean;
  canRun?: boolean;
  result?: string | null;
  readOnly?: boolean;
  /** Whose editor this is — shown to the read-only observer. */
  authorName?: string;
}) {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-line bg-surface">
      <div className="flex items-center justify-between gap-3 border-b border-line px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="mono-label shrink-0 text-[10px] text-faint">Shared editor</span>
          <select
            value={language}
            onChange={(e) => onLanguageChange(e.target.value as ProgrammingLanguage)}
            disabled={readOnly}
            className="rounded-md border border-line-strong bg-surface px-2 py-1 text-[12px] text-fg focus:border-accent focus:outline-none disabled:opacity-60"
          >
            {PROGRAMMING_LANGUAGES.map((l) => (
              <option key={l} value={l}>
                {LANGUAGE_META[l].label}
              </option>
            ))}
          </select>
          {readOnly ? (
            <span className="inline-flex min-w-0 items-center gap-1.5 rounded-full border border-line-strong bg-surface-2 px-2 py-0.5 text-[11px] text-muted">
              <Eye className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span className="truncate">Watching {authorName ?? 'the candidate'} — read-only</span>
            </span>
          ) : null}
        </div>
        {canRun ? (
          <button
            type="button"
            onClick={onRun}
            disabled={running}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-fg px-3 py-1.5 text-[12px] font-medium text-bg hover:opacity-90 disabled:opacity-50"
          >
            <Play className="h-3.5 w-3.5" /> {running ? 'Running…' : 'Run'}
          </button>
        ) : null}
      </div>
      <div className="min-h-0 flex-1">
        <CodeEditor language={language} value={value} onChange={onChange} readOnly={readOnly} />
      </div>
      {result != null ? (
        <div className="max-h-32 overflow-y-auto border-t border-line bg-surface-2 px-3 py-2">
          <pre className="whitespace-pre-wrap font-mono text-[11px] text-muted">{result}</pre>
        </div>
      ) : null}
    </div>
  );
}
