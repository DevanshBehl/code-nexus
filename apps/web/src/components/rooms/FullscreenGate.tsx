import { Maximize } from 'lucide-react';

/**
 * The blocking cover shown whenever a locked room does not hold the viewport.
 *
 * Rooms ask for fullscreen the moment they open, but a browser will only grant
 * it during a user gesture and Escape gives it back at any time. Rather than
 * pretend, the room covers itself: the session keeps running underneath (the
 * call stays connected, the contest clock keeps ticking) but nothing is readable
 * or clickable until the viewport is ours again.
 */
export function FullscreenGate({
  open,
  onEnter,
  title,
  detail,
  refused,
}: {
  open: boolean;
  onEnter: () => void;
  title: string;
  detail: string;
  /** The browser turned the last request down — offer the keyboard way in. */
  refused?: boolean;
}) {
  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="fs-gate-title"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-neutral-950/95 p-6 text-center"
    >
      <div className="max-w-sm">
        <Maximize className="mx-auto mb-4 h-8 w-8 text-white/70" aria-hidden="true" />
        <h2 id="fs-gate-title" className="text-[15px] font-semibold text-white">
          {title}
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-white/60">{detail}</p>
        <button
          type="button"
          autoFocus
          onClick={onEnter}
          className="mt-5 inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-[13px] font-medium text-neutral-900 hover:bg-white/90"
        >
          <Maximize className="h-4 w-4" aria-hidden="true" /> Enter fullscreen
        </button>
        {refused ? (
          <p className="mt-3 text-[12px] leading-relaxed text-amber-300">
            Your browser turned that request down. Allow fullscreen for this site — the permission
            icon sits in the address bar — then press the button again.
          </p>
        ) : null}
      </div>
    </div>
  );
}
