import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Locked rooms — the shared behaviour behind a live interview and a running
 * contest attempt.
 *
 * Both surfaces make the same promise: once you are inside, the session is the
 * only thing on screen and the only way out is to END it (the interviewer ends
 * the interview; the student finishes and submits the contest). Wandering off —
 * Back, a sidebar link, a stray Escape out of fullscreen — is not an exit.
 *
 * Two hooks, because the two halves of that promise have different failure
 * modes:
 *   - `useExitGuard` traps in-app navigation and warns on tab close.
 *   - `useFullscreenLock` holds the viewport, and reports when it has lost it
 *     so the caller can put a blocking gate on screen.
 *
 * Neither is a security boundary. A determined participant can always close the
 * tab or alt-tab, and the browser will never let a page prevent that. These make
 * leaving deliberate and visible, and every rule that actually matters (who may
 * end an interview, when a contest attempt is scored) stays enforced server-side.
 */

/** Safari still ships the prefixed fullscreen API. */
interface FullscreenDocument extends Document {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
}
interface FullscreenElement extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void> | void;
}

function fsDoc(): FullscreenDocument {
  return document as FullscreenDocument;
}

function isFullscreenNow(): boolean {
  const d = fsDoc();
  return !!(d.fullscreenElement ?? d.webkitFullscreenElement);
}

function fullscreenSupported(): boolean {
  if (typeof document === 'undefined') return false;
  // An embedded page (an iframe without `allow="fullscreen"`) has the API but is
  // refused every time. Treating that as "no fullscreen to give" is the honest
  // reading — otherwise the room shows a gate whose button can never work.
  if (document.fullscreenEnabled === false) return false;
  const el = document.documentElement as FullscreenElement;
  return (
    typeof el.requestFullscreen === 'function' || typeof el.webkitRequestFullscreen === 'function'
  );
}

async function enterFullscreen(): Promise<void> {
  const el = document.documentElement as FullscreenElement;
  if (typeof el.requestFullscreen === 'function') {
    await el.requestFullscreen({ navigationUI: 'hide' });
    return;
  }
  await el.webkitRequestFullscreen?.();
}

async function leaveFullscreen(): Promise<void> {
  if (!isFullscreenNow()) return;
  const d = fsDoc();
  if (typeof d.exitFullscreen === 'function') {
    await d.exitFullscreen();
    return;
  }
  await d.webkitExitFullscreen?.();
}

/**
 * Take fullscreen from inside the click that opens a room, before it mounts.
 *
 * Worth doing at the call site: a room asking on mount is often a tick too late
 * for the browser to still count the click as user activation, and the request
 * is refused. Asking during the handler itself is the reliable path, and makes
 * "the room opens fullscreen" true rather than aspirational. Failure is fine —
 * the room's own gate picks it up.
 */
export function requestFullscreenNow(): void {
  if (!fullscreenSupported()) return;
  void enterFullscreen().catch(() => undefined);
}

interface HistoryLockState {
  roomLock?: boolean;
}

/**
 * Block leaving the current route while `active`.
 *
 * The app runs on a plain `<BrowserRouter>`, not a data router, so react-router's
 * `useBlocker` is unavailable. Instead we plant a sentinel history entry when the
 * room opens: the first Back press pops onto that entry rather than out of the
 * room, and the `popstate` handler immediately plants another one. The URL never
 * changes, so react-router sees no navigation and the room never unmounts.
 *
 * `onBlocked` fires each time a Back press is swallowed — the caller is expected
 * to say something, because a button that silently does nothing reads as a bug.
 *
 * Tab close and reload are a separate mechanism (`beforeunload`) and can only be
 * warned about, never prevented.
 */
export function useExitGuard(active: boolean, onBlocked?: () => void): void {
  const notify = useRef(onBlocked);
  useEffect(() => {
    notify.current = onBlocked;
  }, [onBlocked]);

  useEffect(() => {
    if (!active) return;

    const plant = (): void => {
      const state: HistoryLockState = { ...window.history.state, roomLock: true };
      // Same URL, so this is invisible to react-router — it is only a step for
      // Back to land on. Router's own `usr`/`key`/`idx` are carried through.
      window.history.pushState(state, '');
    };
    // Guard against planting twice (StrictMode double-mounts effects in dev).
    if (!(window.history.state as HistoryLockState | null)?.roomLock) plant();

    const onPopState = (): void => {
      plant();
      notify.current?.();
    };
    const onBeforeUnload = (e: BeforeUnloadEvent): void => {
      e.preventDefault();
      e.returnValue = '';
    };

    window.addEventListener('popstate', onPopState);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [active]);
}

export interface FullscreenLock {
  /** True once the viewport is ours — or when the browser has no fullscreen to give. */
  held: boolean;
  /** False on browsers without the fullscreen API (iOS Safari); callers must not gate on it there. */
  supported: boolean;
  /** A request was made and the browser did not grant it — the gate should say so. */
  refused: boolean;
  /** Re-request the viewport. Must be called from a user gesture to be reliable. */
  request: () => void;
}

/**
 * Hold the whole viewport while `active`.
 *
 * Fullscreen cannot be taken unilaterally: browsers only grant it during a user
 * gesture. Entering a room is itself a click ("Go live", "Start contest"), so the
 * automatic attempt on mount usually lands inside that transient activation
 * window — but it is allowed to fail, and pressing Escape leaves fullscreen at
 * any time. `held` is the honest answer either way, and the room shows a gate
 * over itself until a click wins the viewport back.
 *
 * Two things this hook must never do, because both read to the person in the room
 * as a dead button:
 *   - Miss a fullscreen change. The room usually takes the viewport from the click
 *     that opened it, which lands BEFORE `active` turns on (a candidate is not
 *     locked until the interviewer admits them). So the listeners go up as soon as
 *     the API exists, and the state is re-read the moment they do — a transition
 *     nobody was listening for used to leave `held` false forever.
 *   - Ask again when the viewport is already ours. `requestFullscreen` resolves
 *     without firing `fullscreenchange` in that case, so the gate would sit there
 *     swallowing clicks. Already-ours is answered locally instead.
 */
export function useFullscreenLock(active: boolean): FullscreenLock {
  const [supported] = useState(fullscreenSupported);
  const [inFullscreen, setInFullscreen] = useState(isFullscreenNow);
  const [refused, setRefused] = useState(false);
  /** One request at a time: a second one lands mid-transition and is rejected. */
  const pending = useRef(false);

  // Track the viewport whenever the API exists, not only while locked — see above.
  useEffect(() => {
    if (!supported) return;
    const sync = (): void => {
      const now = isFullscreenNow();
      setInFullscreen(now);
      if (now) setRefused(false);
    };
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
    // Catch a transition that completed between this render and this effect.
    sync();
    return () => {
      document.removeEventListener('fullscreenchange', sync);
      document.removeEventListener('webkitfullscreenchange', sync);
    };
  }, [supported]);

  const request = useCallback((): void => {
    if (!supported) return;
    if (isFullscreenNow()) {
      // Already ours — the state was simply behind. Say so and stop.
      setInFullscreen(true);
      setRefused(false);
      return;
    }
    if (pending.current) return;
    pending.current = true;
    void enterFullscreen()
      .catch(() => undefined)
      .finally(() => {
        pending.current = false;
        // Trust the document, not the promise: some browsers resolve a request
        // they did not honour, and `fullscreenchange` may already have run.
        const now = isFullscreenNow();
        setInFullscreen(now);
        setRefused(!now);
      });
  }, [supported]);

  useEffect(() => {
    if (!active || !supported) return;
    request();
    return () => {
      // Hand the viewport back on the way out — nobody expects the page they
      // land on after an interview to still be fullscreen.
      void leaveFullscreen().catch(() => undefined);
    };
  }, [active, supported, request]);

  return { held: !supported || inFullscreen, supported, refused, request };
}
