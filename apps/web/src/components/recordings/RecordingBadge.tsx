import { Circle, ShieldAlert } from 'lucide-react';

/**
 * The recording indicator.
 *
 * This is a FUNCTIONAL requirement, not decoration: it is shown to everyone in
 * the room — not just the person whose browser is capturing — for the entire
 * duration. Recording someone's face without them plainly knowing is the one
 * failure in this feature that no later bug fix can undo, so the badge is always
 * rendered when capture is live and is never conditional on role.
 */
export function RecordingBadge({ live }: { live: boolean }) {
  if (!live) return null;
  return (
    <span
      role="status"
      aria-live="polite"
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-red-600/20 px-2.5 py-1 text-[11px] font-semibold text-red-300"
    >
      <Circle
        className="h-2 w-2 animate-pulse fill-red-500 text-red-500 motion-reduce:animate-none"
        aria-hidden="true"
      />
      Recording
    </span>
  );
}

/**
 * Shown to the candidate BEFORE capture starts. Consent is not a checkbox we
 * bolt on later — the person on camera is told what is happening, who will see
 * it, and is given the chance to leave first.
 */
export function RecordingConsentNotice({
  onAcknowledge,
  onDecline,
}: {
  onAcknowledge: () => void;
  onDecline: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="rec-consent-title"
      className="absolute inset-0 z-20 flex items-center justify-center bg-neutral-950/85 p-6"
    >
      <div className="w-full max-w-md rounded-2xl border border-white/15 bg-neutral-900 p-6">
        <div className="mb-3 flex items-center gap-2">
          <ShieldAlert className="h-5 w-5 shrink-0 text-amber-400" aria-hidden="true" />
          <h2 id="rec-consent-title" className="text-[15px] font-semibold text-white">
            This interview will be recorded
          </h2>
        </div>
        <p className="text-[13px] leading-relaxed text-white/70">
          Your interviewer is about to start recording the video, audio and shared screen of this
          session. The recording is private: only you, your interviewers and the hosting
          organisation can view it. It is never shown to other students.
        </p>
        <p className="mt-3 text-[13px] leading-relaxed text-white/70">
          If you would rather not be recorded, you can leave now and contact your placement office.
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onAcknowledge}
            className="rounded-lg bg-white px-4 py-2 text-[13px] font-medium text-neutral-900 hover:bg-white/90"
          >
            I understand, continue
          </button>
          <button
            type="button"
            onClick={onDecline}
            className="text-[13px] font-medium text-white/60 hover:text-white"
          >
            Leave the interview
          </button>
        </div>
      </div>
    </div>
  );
}
