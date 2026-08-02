import { useCallback, useEffect, useState } from 'react';
import type { ProgrammingLanguage } from '@code-nexus/types';

/**
 * The bits of an IDE that are the same wherever you are typing code on this
 * platform — practising in the arena, sitting a contest, or working through a
 * problem in a live interview.
 *
 * Two things live here, and both exist because of the same observation: the
 * editor is not a widget on a page, it is a tool somebody works in for an hour.
 *
 *  - PREFERENCES follow the person, not the page. Someone who sizes the text up
 *    once should not have to do it again in the contest that starts in ten
 *    minutes, so they are stored per browser and read by every surface.
 *  - DRAFTS are saved as you type. A student who reloads mid-problem — or whose
 *    laptop sleeps during a contest — must not lose their work, and "the code was
 *    only ever in React state" is not a defensible reason for them to.
 */

// ---- Preferences ------------------------------------------------------------

export interface EditorPrefs {
  fontSize: number;
  /** Soft-wrap long lines instead of scrolling sideways. */
  wordWrap: boolean;
}

export const FONT_SIZE_MIN = 11;
export const FONT_SIZE_MAX = 22;
const DEFAULT_PREFS: EditorPrefs = { fontSize: 13, wordWrap: false };
const PREFS_KEY = 'cn:editor:prefs';

function readPrefs(): EditorPrefs {
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<EditorPrefs>;
    return {
      fontSize: clampFontSize(Number(parsed.fontSize) || DEFAULT_PREFS.fontSize),
      wordWrap: parsed.wordWrap === true,
    };
  } catch {
    // Private mode, a full quota, a hand-edited value — none of it is worth a
    // broken editor. Defaults are always a correct answer here.
    return DEFAULT_PREFS;
  }
}

export function clampFontSize(size: number): number {
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(size)));
}

/** Editor preferences, shared across every surface and persisted per browser. */
export function useEditorPrefs(): {
  prefs: EditorPrefs;
  zoom: (delta: number) => void;
  toggleWrap: () => void;
} {
  const [prefs, setPrefs] = useState<EditorPrefs>(readPrefs);

  useEffect(() => {
    try {
      window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      /* nothing to do — the session still works, it just will not be remembered */
    }
  }, [prefs]);

  const zoom = useCallback((delta: number): void => {
    setPrefs((p) => ({ ...p, fontSize: clampFontSize(p.fontSize + delta) }));
  }, []);
  const toggleWrap = useCallback((): void => {
    setPrefs((p) => ({ ...p, wordWrap: !p.wordWrap }));
  }, []);

  return { prefs, zoom, toggleWrap };
}

// ---- Drafts -----------------------------------------------------------------

/**
 * Where a draft belongs. Scoped by surface so the same problem attempted in the
 * arena and inside a contest never share a buffer — they are different attempts
 * at different stakes, and one overwriting the other would be indefensible.
 */
export function draftKey(scope: string, id: string, language: ProgrammingLanguage): string {
  return `cn:draft:${scope}:${id}:${language}`;
}

export function loadDraft(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function saveDraft(key: string, code: string): void {
  try {
    window.localStorage.setItem(key, code);
  } catch {
    /* out of quota: the code is still on screen, which is what matters */
  }
}

export function clearDraft(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* see above */
  }
}

// ---- Shortcut labels --------------------------------------------------------

/**
 * Mac writes ⌘, everyone else writes Ctrl. Worth getting right: a shortcut hint
 * spelled for the wrong keyboard is worse than none, because people try it.
 */
export const IS_MAC =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '');

export const MOD_KEY = IS_MAC ? '⌘' : 'Ctrl';
export const RUN_SHORTCUT = `${MOD_KEY}${IS_MAC ? '' : '+'}↵`;
export const SUBMIT_SHORTCUT = `${MOD_KEY}${IS_MAC ? '⇧' : '+Shift+'}↵`;

/**
 * Python is a 4-space language and the others are 2-space ones here. Guessing
 * this wrong is not cosmetic in Python — it is a syntax error waiting to happen.
 */
export function tabSizeFor(language: ProgrammingLanguage): number {
  return language === 'PYTHON' ? 4 : 2;
}
