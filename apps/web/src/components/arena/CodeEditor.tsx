import { useEffect, useRef } from 'react';
import Editor, { type Monaco, type EditorProps, type OnMount } from '@monaco-editor/react';
import type { ProgrammingLanguage } from '@code-nexus/types';
import { LANGUAGE_META } from '@code-nexus/types';
import { useTheme } from '../../lib/theme.ts';
import { tabSizeFor } from '../../lib/editor.ts';

const MONO_FONT =
  "'SF Mono', 'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, Consolas, monospace";

/** Editor themes tuned to the app's design tokens (cohesive with the surfaces). */
function defineThemes(monaco: Monaco): void {
  monaco.editor.defineTheme('cn-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': '#131312',
      'editor.foreground': '#f5f4f1',
      'editorLineNumber.foreground': '#4a4740',
      'editorLineNumber.activeForeground': '#a8a39a',
      'editor.lineHighlightBackground': '#1a1a18',
      'editor.lineHighlightBorder': '#00000000',
      'editorCursor.foreground': '#8b87f5',
      'editor.selectionBackground': '#8b87f533',
      'editor.inactiveSelectionBackground': '#8b87f51f',
      'editorIndentGuide.background1': '#242422',
      'editorIndentGuide.activeBackground1': '#3a3a36',
      'editorGutter.background': '#131312',
      'editorWidget.background': '#1a1a18',
      'editorWidget.border': '#242422',
      'scrollbarSlider.background': '#ffffff12',
      'scrollbarSlider.hoverBackground': '#ffffff20',
      'scrollbarSlider.activeBackground': '#ffffff2e',
    },
  });
  monaco.editor.defineTheme('cn-light', {
    base: 'vs',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': '#ffffff',
      'editor.foreground': '#17150f',
      'editorLineNumber.foreground': '#948f83',
      'editorLineNumber.activeForeground': '#3d3931',
      'editor.lineHighlightBackground': '#f2f0e9',
      'editor.lineHighlightBorder': '#00000000',
      'editorCursor.foreground': '#4338ca',
      'editor.selectionBackground': '#4338ca33',
      'editor.inactiveSelectionBackground': '#4338ca1f',
      'editorIndentGuide.background1': '#e0ddd4',
      'editorIndentGuide.activeBackground1': '#b8b3a6',
      'editorGutter.background': '#ffffff',
      'editorWidget.background': '#ffffff',
      'editorWidget.border': '#cdc8bb',
      'scrollbarSlider.background': '#17150f1f',
      'scrollbarSlider.hoverBackground': '#17150f33',
      'scrollbarSlider.activeBackground': '#17150f4d',
    },
  });
}

const OPTIONS: EditorProps['options'] = {
  minimap: { enabled: false },
  fontFamily: MONO_FONT,
  fontLigatures: true,
  lineHeight: 1.6,
  letterSpacing: 0.2,
  smoothScrolling: true,
  cursorBlinking: 'smooth',
  cursorSmoothCaretAnimation: 'on',
  roundedSelection: true,
  scrollBeyondLastLine: false,
  padding: { top: 14, bottom: 14 },
  renderLineHighlight: 'all',
  bracketPairColorization: { enabled: true },
  guides: { bracketPairs: 'active', indentation: true },
  scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10, useShadows: false },
  overviewRulerLanes: 0,
  automaticLayout: true,
  fixedOverflowWidgets: true,
  // The editing affordances people expect from a real IDE and notice the absence
  // of immediately: pairs close, suggestions appear as you type, a stray tab does
  // not silently become the wrong indentation.
  autoClosingBrackets: 'languageDefined',
  autoClosingQuotes: 'languageDefined',
  autoIndent: 'full',
  formatOnPaste: true,
  detectIndentation: false,
  insertSpaces: true,
  suggestOnTriggerCharacters: true,
  quickSuggestions: { other: true, comments: false, strings: false },
  tabCompletion: 'on',
  snippetSuggestions: 'inline',
  showFoldingControls: 'mouseover',
  renderWhitespace: 'selection',
  stickyScroll: { enabled: false },
  contextmenu: true,
};

interface CodeEditorProps {
  language: ProgrammingLanguage;
  value: string;
  onChange: (value: string) => void;
  /**
   * Watch-only mode — used by an interviewer observing the candidate's live
   * keystrokes. The caret is hidden too, so the observer never mistakes their own
   * cursor for a shared one. (The real write-lock is enforced at the gateway.)
   */
  readOnly?: boolean;
  fontSize?: number;
  wordWrap?: boolean;
  /** Bound to the same shortcut everywhere: Cmd/Ctrl+Enter. */
  onRun?: () => void;
  /** Cmd/Ctrl+Shift+Enter. Absent on surfaces with nothing to submit to. */
  onSubmit?: () => void;
  /** Caret position, for the status bar. */
  onCursorChange?: (line: number, column: number) => void;
}

/** Monaco editor themed to match the app, with a premium code-editing feel. */
export function CodeEditor({
  language,
  value,
  onChange,
  readOnly = false,
  fontSize = 13,
  wordWrap = false,
  onRun,
  onSubmit,
  onCursorChange,
}: CodeEditorProps) {
  const { theme } = useTheme();
  // Commands are registered once on mount but must call whatever the CURRENT
  // handler is — re-registering on every render would leak commands, and closing
  // over the first render's handler would run yesterday's code.
  const run = useRef(onRun);
  const submit = useRef(onSubmit);
  const cursor = useRef(onCursorChange);
  useEffect(() => {
    run.current = onRun;
    submit.current = onSubmit;
    cursor.current = onCursorChange;
  }, [onRun, onSubmit, onCursorChange]);

  const onMount: OnMount = (editor, monaco) => {
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => run.current?.());
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter, () =>
      submit.current?.(),
    );
    // Swallow the browser's Save dialog: in an editor, Cmd+S means "I am done
    // typing", and a download prompt is a jarring answer to that.
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => undefined);
    editor.onDidChangeCursorPosition((e) =>
      cursor.current?.(e.position.lineNumber, e.position.column),
    );
    cursor.current?.(1, 1);
  };

  return (
    <Editor
      height="100%"
      language={LANGUAGE_META[language].monaco}
      theme={theme === 'dark' ? 'cn-dark' : 'cn-light'}
      value={value}
      onChange={(v) => onChange(v ?? '')}
      beforeMount={defineThemes}
      onMount={onMount}
      loading={<div className="p-4 text-[13px] text-muted">Loading editor…</div>}
      options={{
        ...OPTIONS,
        fontSize,
        tabSize: tabSizeFor(language),
        wordWrap: wordWrap ? 'on' : 'off',
        ...(readOnly ? { readOnly: true, domReadOnly: true, renderLineHighlight: 'none' } : {}),
      }}
    />
  );
}
