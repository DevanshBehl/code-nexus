import { useState, type ReactNode } from 'react';
import {
  Check,
  Copy,
  Eye,
  Maximize2,
  Minimize2,
  Minus,
  Plus,
  RotateCcw,
  WrapText,
} from 'lucide-react';
import { LANGUAGE_META, type ProgrammingLanguage } from '@code-nexus/types';
import {
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  RUN_SHORTCUT,
  tabSizeFor,
  useEditorPrefs,
} from '../../lib/editor.ts';
import { CodeEditor } from './CodeEditor.tsx';

/**
 * The editor, with the chrome that makes it an IDE rather than a text box: a
 * toolbar that owns the language and the buffer, and a status bar that answers
 * "where am I and what am I typing into".
 *
 * There is one of these, used by all three places this platform asks somebody to
 * write code — the arena, a contest attempt, and the shared editor in a live
 * interview. That is deliberate: a candidate should not have to re-learn the
 * controls at the exact moment the stakes are highest, and a preference they set
 * while practising should still be there in the interview.
 */
export function EditorPane({
  language,
  languages,
  onLanguageChange,
  value,
  onChange,
  onRun,
  onSubmit,
  onReset,
  actions,
  readOnly = false,
  readOnlyNote,
  expanded,
  onToggleExpand,
  label,
  savedNote,
}: {
  language: ProgrammingLanguage;
  /** Which languages this surface allows (a contest may allow only some). */
  languages: readonly ProgrammingLanguage[];
  onLanguageChange: (l: ProgrammingLanguage) => void;
  value: string;
  onChange: (v: string) => void;
  /** Cmd/Ctrl+Enter, and whatever button the caller puts in `actions`. */
  onRun?: () => void;
  onSubmit?: () => void;
  /** Restore the problem's starter code. Omitted where there is none. */
  onReset?: () => void;
  /** Run/Submit buttons — owned by the caller, since only it knows the verbs. */
  actions?: ReactNode;
  readOnly?: boolean;
  /** Why it is read-only, e.g. "Watching Asha". Shown in place of the controls. */
  readOnlyNote?: string;
  expanded?: boolean;
  onToggleExpand?: () => void;
  /** Overrides the filename shown in the status bar. */
  label?: string;
  /** e.g. "Draft saved" — reassurance that leaving will not cost anything. */
  savedNote?: string;
}) {
  const { prefs, zoom, toggleWrap } = useEditorPrefs();
  const [pos, setPos] = useState({ line: 1, column: 1 });
  const [copied, setCopied] = useState(false);

  const copy = (): void => {
    void navigator.clipboard
      ?.writeText(value)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => undefined);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-line bg-surface px-2.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <select
            aria-label="Language"
            value={language}
            disabled={readOnly}
            onChange={(e) => onLanguageChange(e.target.value as ProgrammingLanguage)}
            className="rounded-md border border-line-strong bg-surface-2 px-2.5 py-1 text-[12px] font-medium text-fg transition-colors hover:bg-surface focus:border-accent focus:outline-none disabled:opacity-60"
          >
            {languages.map((l) => (
              <option key={l} value={l}>
                {LANGUAGE_META[l].label}
              </option>
            ))}
          </select>

          {readOnly ? (
            <span className="inline-flex min-w-0 items-center gap-1.5 rounded-full border border-line-strong bg-surface-2 px-2 py-0.5 text-[11px] text-muted">
              <Eye className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span className="truncate">{readOnlyNote ?? 'Read-only'}</span>
            </span>
          ) : (
            <>
              {onReset ? (
                <ToolButton label="Reset to starter code" onClick={onReset}>
                  <RotateCcw className="h-3.5 w-3.5" />
                </ToolButton>
              ) : null}
              <ToolButton label={copied ? 'Copied' : 'Copy all'} onClick={copy}>
                {copied ? (
                  <Check className="h-3.5 w-3.5 text-success" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </ToolButton>
            </>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <div className="hidden items-center rounded-md border border-line bg-surface-2 sm:flex">
            <ToolButton
              label="Smaller text"
              onClick={() => zoom(-1)}
              disabled={prefs.fontSize <= FONT_SIZE_MIN}
            >
              <Minus className="h-3.5 w-3.5" />
            </ToolButton>
            <span className="w-6 text-center text-[11px] tabular-nums text-faint">
              {prefs.fontSize}
            </span>
            <ToolButton
              label="Bigger text"
              onClick={() => zoom(1)}
              disabled={prefs.fontSize >= FONT_SIZE_MAX}
            >
              <Plus className="h-3.5 w-3.5" />
            </ToolButton>
          </div>
          <ToolButton
            label={prefs.wordWrap ? 'Word wrap on' : 'Word wrap off'}
            onClick={toggleWrap}
            active={prefs.wordWrap}
          >
            <WrapText className="h-3.5 w-3.5" />
          </ToolButton>
          {onToggleExpand ? (
            <ToolButton
              label={expanded ? 'Show the problem' : 'Full-width editor'}
              onClick={onToggleExpand}
              active={expanded}
            >
              {expanded ? (
                <Minimize2 className="h-3.5 w-3.5" />
              ) : (
                <Maximize2 className="h-3.5 w-3.5" />
              )}
            </ToolButton>
          ) : null}
          {actions}
        </div>
      </div>

      {/* Editor */}
      <div className="min-h-0 flex-1">
        <CodeEditor
          language={language}
          value={value}
          onChange={onChange}
          readOnly={readOnly}
          fontSize={prefs.fontSize}
          wordWrap={prefs.wordWrap}
          onRun={onRun}
          onSubmit={onSubmit}
          onCursorChange={(line, column) => setPos({ line, column })}
        />
      </div>

      {/* Status bar */}
      <div className="flex h-6 shrink-0 items-center justify-between gap-3 border-t border-line bg-surface px-3 text-[10.5px] text-faint">
        <div className="flex min-w-0 items-center gap-3">
          <span className="mono-label truncate">{label ?? LANGUAGE_META[language].filename}</span>
          <span className="tabular-nums">
            Ln {pos.line}, Col {pos.column}
          </span>
          <span className="hidden sm:inline">Spaces: {tabSizeFor(language)}</span>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {savedNote ? <span className="text-success">{savedNote}</span> : null}
          {onRun && !readOnly ? (
            <span className="hidden md:inline">
              <kbd className="rounded border border-line px-1 py-0.5 font-sans">{RUN_SHORTCUT}</kbd>{' '}
              to run
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ToolButton({
  label,
  onClick,
  children,
  active,
  disabled,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors disabled:opacity-40 ${
        active ? 'bg-accent-soft text-accent' : 'text-faint hover:bg-surface-2 hover:text-fg'
      }`}
    >
      {children}
    </button>
  );
}
