import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, renderHook } from '@testing-library/react';
import { useExitGuard, useFullscreenLock } from './roomLock.ts';

/**
 * These guard the promise a locked room makes to the people inside it: Back does
 * not get you out of a live interview or a running contest attempt, and the room
 * knows when it has lost the viewport so it can cover itself.
 */

function popBack(): void {
  act(() => {
    window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }));
  });
}

describe('useExitGuard', () => {
  afterEach(() => {
    window.history.replaceState(null, '');
  });

  it('plants a sentinel entry so Back has somewhere harmless to land', () => {
    renderHook(() => useExitGuard(true));
    expect(window.history.state).toMatchObject({ roomLock: true });
  });

  it('re-plants on every Back press and reports the block', () => {
    const onBlocked = vi.fn();
    renderHook(() => useExitGuard(true, onBlocked));

    popBack();
    expect(onBlocked).toHaveBeenCalledTimes(1);
    expect(window.history.state).toMatchObject({ roomLock: true });

    popBack();
    expect(onBlocked).toHaveBeenCalledTimes(2);
  });

  it('stays out of the way when inactive', () => {
    const onBlocked = vi.fn();
    renderHook(() => useExitGuard(false, onBlocked));
    expect(window.history.state).toBeNull();
    popBack();
    expect(onBlocked).not.toHaveBeenCalled();
  });

  it('releases once the session ends, so the room can navigate away itself', () => {
    const onBlocked = vi.fn();
    const { rerender } = renderHook(({ active }) => useExitGuard(active, onBlocked), {
      initialProps: { active: true },
    });
    rerender({ active: false });
    popBack();
    expect(onBlocked).not.toHaveBeenCalled();
  });
});

/** jsdom ships no fullscreen API, so stand one up that we can drive. */
function stubFullscreen({ refuse = false }: { refuse?: boolean } = {}) {
  let element: Element | null = null;
  const fire = (): void => {
    document.dispatchEvent(new Event('fullscreenchange'));
  };
  const requestFullscreen = vi.fn(() => {
    // A browser with no user activation to spend rejects and changes nothing.
    if (refuse) return Promise.reject(new Error('denied'));
    // Already fullscreen: resolves, but there is no change, so NO event. This is
    // the browser behaviour that made the gate's button look broken.
    if (element) return Promise.resolve();
    element = document.documentElement;
    fire();
    return Promise.resolve();
  });
  const exitFullscreen = vi.fn(() => {
    element = null;
    fire();
    return Promise.resolve();
  });
  Object.defineProperty(document.documentElement, 'requestFullscreen', {
    value: requestFullscreen,
    configurable: true,
  });
  Object.defineProperty(document, 'exitFullscreen', {
    value: exitFullscreen,
    configurable: true,
  });
  Object.defineProperty(document, 'fullscreenElement', {
    get: () => element,
    configurable: true,
  });
  return {
    requestFullscreen,
    exitFullscreen,
    escape: () => act(() => void exitFullscreen()),
    /** Fullscreen taken before the room mounted — e.g. by the click that opened it. */
    grantSilently: () => {
      element = document.documentElement;
    },
  };
}

/** `renderHook` re-renders on its own; this keeps the assertions on one value. */
function FullscreenProbe({
  active,
  onState,
  onLock,
}: {
  active: boolean;
  onState: (held: boolean) => void;
  onLock?: (lock: ReturnType<typeof useFullscreenLock>) => void;
}) {
  const lock = useFullscreenLock(active);
  onState(lock.held);
  onLock?.(lock);
  return null;
}

describe('useFullscreenLock', () => {
  afterEach(() => {
    // The stub installs own properties on the document; drop them, or the
    // "no fullscreen API" case would still find the previous test's stub.
    Reflect.deleteProperty(document.documentElement, 'requestFullscreen');
    Reflect.deleteProperty(document, 'exitFullscreen');
    Reflect.deleteProperty(document, 'fullscreenElement');
  });

  it('takes the viewport when the room opens and gives it back on the way out', async () => {
    const fs = stubFullscreen();
    const seen: boolean[] = [];
    const { unmount } = render(<FullscreenProbe active onState={(h) => seen.push(h)} />);
    await act(async () => {});

    expect(fs.requestFullscreen).toHaveBeenCalled();
    expect(seen.at(-1)).toBe(true);

    unmount();
    expect(fs.exitFullscreen).toHaveBeenCalled();
  });

  it('reports the loss when the viewport is given back mid-session', async () => {
    const fs = stubFullscreen();
    const seen: boolean[] = [];
    render(<FullscreenProbe active onState={(h) => seen.push(h)} />);
    await act(async () => {});
    expect(seen.at(-1)).toBe(true);

    // Escape hands fullscreen back — the room must find out so it can gate itself.
    fs.escape();
    expect(seen.at(-1)).toBe(false);
  });

  it('does not ask while inactive', async () => {
    const fs = stubFullscreen();
    render(<FullscreenProbe active={false} onState={() => {}} />);
    await act(async () => {});
    expect(fs.requestFullscreen).not.toHaveBeenCalled();
  });

  it('reports held on browsers with no fullscreen to give, so nothing is gated shut', async () => {
    // No stub: jsdom has no fullscreen API, standing in for iOS Safari.
    const seen: boolean[] = [];
    render(<FullscreenProbe active onState={(h) => seen.push(h)} />);
    await act(async () => {});
    expect(seen.at(-1)).toBe(true);
  });

  it('notices fullscreen that was taken before the lock switched on', async () => {
    // The room asks from the click that opens it, which lands well before the
    // lock goes live (a candidate is not locked in until they are admitted). A
    // lock that only starts listening at that point never hears the change and
    // gates a room that is already fullscreen.
    const fs = stubFullscreen();
    const seen: boolean[] = [];
    const { rerender } = render(<FullscreenProbe active={false} onState={(h) => seen.push(h)} />);
    fs.grantSilently();

    rerender(<FullscreenProbe active onState={(h) => seen.push(h)} />);
    await act(async () => {});

    expect(seen.at(-1)).toBe(true);
  });

  it('answers a request made while the viewport is already ours', async () => {
    // `requestFullscreen` resolves without firing `fullscreenchange` when there
    // is nothing to change — so the gate must not sit there waiting for one.
    const fs = stubFullscreen();
    const seen: boolean[] = [];
    let lock!: ReturnType<typeof useFullscreenLock>;
    render(
      <FullscreenProbe
        active={false}
        onState={(h) => seen.push(h)}
        onLock={(l) => {
          lock = l;
        }}
      />,
    );
    fs.grantSilently();
    fs.requestFullscreen.mockClear();

    await act(async () => lock.request());

    expect(seen.at(-1)).toBe(true);
    expect(fs.requestFullscreen).not.toHaveBeenCalled();
  });

  it('says so when the browser refuses, instead of looking like a dead button', async () => {
    const fs = stubFullscreen({ refuse: true });
    const seen: boolean[] = [];
    let lock!: ReturnType<typeof useFullscreenLock>;
    render(
      <FullscreenProbe
        active
        onState={(h) => seen.push(h)}
        onLock={(l) => {
          lock = l;
        }}
      />,
    );
    await act(async () => {});

    expect(fs.requestFullscreen).toHaveBeenCalled();
    expect(seen.at(-1)).toBe(false);
    expect(lock.refused).toBe(true);
  });
});
