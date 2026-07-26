import type { LucideIcon } from 'lucide-react';

/**
 * The Google-Meet-style control dock. Everything in the room is reached from
 * here — the room itself starts as a plain call and each surface is opt-in.
 *
 * Two visually distinct kinds of button live side by side, and the difference
 * matters: SHARED toggles (whiteboard / IDE) move the whole room and are shown
 * "on" for everyone, while LOCAL toggles (chat / people) only open a panel on
 * your own screen. The tooltip on each says which it is.
 */

export function DockButton({
  icon: Icon,
  label,
  onClick,
  active = false,
  danger = false,
  disabled = false,
  shared = false,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  /** Rendered as engaged (mic on, whiteboard open, panel showing…). */
  active?: boolean;
  /** Destructive affordance — leave / end. */
  danger?: boolean;
  disabled?: boolean;
  /** Marks a toggle that changes the stage for every participant. */
  shared?: boolean;
}) {
  const tone = danger
    ? 'bg-red-600 text-white hover:bg-red-500'
    : active
      ? 'bg-white text-neutral-900 hover:bg-white/90'
      : 'bg-white/10 text-white hover:bg-white/20';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={danger ? undefined : active}
      title={shared ? `${label} (shared with everyone)` : label}
      className={`group relative inline-flex h-11 items-center gap-2 rounded-full px-4 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70 ${tone}`}
    >
      <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
      <span className="hidden sm:inline">{label}</span>
      <span className="sr-only sm:hidden">{label}</span>
      {shared && active ? (
        <span
          className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-emerald-400 ring-2 ring-neutral-900"
          aria-hidden="true"
        />
      ) : null}
    </button>
  );
}

/** The fixed bar the dock buttons sit in. */
export function MeetDock({ children }: { children: React.ReactNode }) {
  return (
    <footer className="shrink-0 border-t border-white/10 bg-neutral-900/95 px-4 py-3 backdrop-blur">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-2">
        {children}
      </div>
    </footer>
  );
}
