import Editor, { type Monaco, type EditorProps } from '@monaco-editor/react';
import type { ProgrammingLanguage } from '@code-nexus/types';
import { LANGUAGE_META } from '@code-nexus/types';
import { useTheme } from '../../lib/theme.ts';

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
      'editorLineNumber.foreground': '#c4bfb6',
      'editorLineNumber.activeForeground': '#57534e',
      'editor.lineHighlightBackground': '#f7f6f3',
      'editor.lineHighlightBorder': '#00000000',
      'editorCursor.foreground': '#4f46e5',
      'editor.selectionBackground': '#4f46e51f',
      'editorIndentGuide.background1': '#eeece7',
      'editorIndentGuide.activeBackground1': '#dcd9d1',
      'editorGutter.background': '#ffffff',
      'editorWidget.background': '#ffffff',
      'editorWidget.border': '#e8e6e0',
    },
  });
}

const OPTIONS: EditorProps['options'] = {
  minimap: { enabled: false },
  fontFamily: MONO_FONT,
  fontLigatures: true,
  fontSize: 13,
  lineHeight: 21,
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
  tabSize: 2,
  fixedOverflowWidgets: true,
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
}

/** Monaco editor themed to match the app, with a premium code-editing feel. */
export function CodeEditor({ language, value, onChange, readOnly = false }: CodeEditorProps) {
  const { theme } = useTheme();
  return (
    <Editor
      height="100%"
      language={LANGUAGE_META[language].monaco}
      theme={theme === 'dark' ? 'cn-dark' : 'cn-light'}
      value={value}
      onChange={(v) => onChange(v ?? '')}
      beforeMount={defineThemes}
      loading={<div className="p-4 text-[13px] text-muted">Loading editor…</div>}
      options={
        readOnly
          ? { ...OPTIONS, readOnly: true, domReadOnly: true, renderLineHighlight: 'none' }
          : OPTIONS
      }
    />
  );
}
