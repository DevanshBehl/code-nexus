import { Play, Loader2 } from 'lucide-react';
import {
  PROGRAMMING_LANGUAGES,
  type ProgrammingLanguage,
  type SubmissionDto,
} from '@code-nexus/types';
import { EditorPane } from '../arena/EditorPane.tsx';
import { ResultPanel } from '../arena/ResultPanel.tsx';

/**
 * The shared code editor for the interview room. Value + language are controlled
 * by the parent (synced across peers via the gateway).
 *
 * It is the SAME editor a candidate practises in — same toolbar, same shortcuts,
 * same status bar, same remembered font size. An interview is the worst moment to
 * hand someone an unfamiliar tool, and the ten seconds spent hunting for the run
 * button are ten seconds of thinking out loud that they do not get back.
 *
 * The IDE is ASYMMETRIC on purpose: only the candidate types. Interviewers get the
 * same document streaming in live but read-only, so they watch the candidate work
 * without being able to nudge the code. "Run" (candidate only) reuses the Phase-6
 * execution pipeline, and its verdict is rendered exactly as the arena renders it.
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
  resultError,
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
  /** The judge's answer to the last Run, shown to everyone in the room. */
  result?: SubmissionDto | null;
  /** The run never reached the judge (not connected, rate limited…). */
  resultError?: string;
  readOnly?: boolean;
  /** Whose editor this is — shown to the read-only observer. */
  authorName?: string;
}) {
  const showConsole = !!result || !!resultError || !!running;

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-line bg-surface">
      <EditorPane
        language={language}
        languages={PROGRAMMING_LANGUAGES}
        onLanguageChange={onLanguageChange}
        value={value}
        onChange={onChange}
        onRun={canRun ? onRun : undefined}
        readOnly={readOnly}
        readOnlyNote={`Watching ${authorName ?? 'the candidate'} — read-only`}
        actions={
          canRun ? (
            <button
              type="button"
              onClick={onRun}
              disabled={running}
              className="ml-1 inline-flex shrink-0 items-center gap-1.5 rounded-md bg-fg px-3 py-1.5 text-[12px] font-medium text-bg transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {running ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              {running ? 'Running…' : 'Run'}
            </button>
          ) : null
        }
      />

      {/* The console appears only once there is something in it — an empty pane
          would cost the candidate rows of editor for nothing. */}
      {showConsole ? (
        <div className="max-h-[38%] shrink-0 overflow-y-auto border-t border-line bg-surface-2 px-3 py-3">
          <ResultPanel sub={result ?? undefined} pending={!!running} error={resultError} started />
        </div>
      ) : null}
    </div>
  );
}
