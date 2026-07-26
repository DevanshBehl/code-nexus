import { useState } from 'react';
import { Users } from 'lucide-react';
import {
  FEEDBACK_RECOMMENDATIONS,
  feedbackCreateSchema,
  type FeedbackDto,
  type InterviewPeer,
  type InterviewStatus,
} from '@code-nexus/types';
import {
  INTERVIEW_STATUS_LABEL,
  INTERVIEW_STATUS_STYLE,
  RECOMMENDATION_LABEL,
} from '../../lib/interviews.ts';
import { FormError } from '../forms/Field.tsx';

export function InterviewStatusBadge({ status }: { status: InterviewStatus }) {
  return (
    <span
      className={`mono-label rounded-full border px-2 py-0.5 text-[9px] ${INTERVIEW_STATUS_STYLE[status]}`}
    >
      {status === 'LIVE' ? '● ' : ''}
      {INTERVIEW_STATUS_LABEL[status]}
    </span>
  );
}

export function PeerRoster({ peers, count }: { peers: InterviewPeer[]; count: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-surface px-2.5 py-1 text-[12px] font-medium text-fg">
        <Users className="h-3.5 w-3.5 text-muted" aria-hidden="true" />
        <span className="tabular-nums">{count}</span> in room
      </span>
      <div className="flex flex-wrap gap-1">
        {peers.map((p) => (
          <span
            key={p.peerId}
            className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-muted"
            title={p.role}
          >
            {p.displayName}
          </span>
        ))}
      </div>
    </div>
  );
}

/** The interviewer's private feedback form. */
export function FeedbackForm({
  onSubmit,
  canAdvance,
  pending,
}: {
  onSubmit: (v: {
    rating: number;
    notes: string;
    recommendation: string;
    advanceApplicationTo?: 'SHORTLISTED' | 'OFFERED' | 'REJECTED';
  }) => void;
  canAdvance: boolean;
  pending?: boolean;
}) {
  const [rating, setRating] = useState(3);
  const [notes, setNotes] = useState('');
  const [recommendation, setRecommendation] = useState('YES');
  const [advance, setAdvance] = useState('');
  const [error, setError] = useState<string>();

  const submit = (e: React.FormEvent): void => {
    e.preventDefault();
    const body = {
      rating,
      notes: notes.trim(),
      recommendation,
      ...(advance
        ? { advanceApplicationTo: advance as 'SHORTLISTED' | 'OFFERED' | 'REJECTED' }
        : {}),
    };
    const parsed = feedbackCreateSchema.safeParse(body);
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => i.message).join('; '));
      return;
    }
    onSubmit(parsed.data);
  };

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <FormError message={error} />
      <div className="grid grid-cols-2 gap-4">
        <label className="block">
          <span className="mb-1.5 block text-[13px] font-medium text-fg">Rating (1–5)</span>
          <div className="flex gap-1.5">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setRating(n)}
                className={`h-9 w-9 rounded-lg border text-[13px] font-semibold ${
                  rating >= n
                    ? 'border-accent bg-accent-soft text-accent'
                    : 'border-line-strong text-muted hover:bg-surface-2'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[13px] font-medium text-fg">Recommendation</span>
          <select
            value={recommendation}
            onChange={(e) => setRecommendation(e.target.value)}
            className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none"
          >
            {FEEDBACK_RECOMMENDATIONS.map((r) => (
              <option key={r} value={r}>
                {RECOMMENDATION_LABEL[r]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="block">
        <span className="mb-1.5 block text-[13px] font-medium text-fg">Notes (private)</span>
        <textarea
          rows={4}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none"
          placeholder="Strengths, concerns, signal…"
        />
      </label>
      {canAdvance ? (
        <label className="block">
          <span className="mb-1.5 block text-[13px] font-medium text-fg">
            Advance linked application (optional)
          </span>
          <select
            value={advance}
            onChange={(e) => setAdvance(e.target.value)}
            className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none"
          >
            <option value="">Leave unchanged</option>
            <option value="SHORTLISTED">Shortlist</option>
            <option value="OFFERED">Offer</option>
            <option value="REJECTED">Reject</option>
          </select>
        </label>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-fg px-4 py-2.5 text-sm font-medium text-bg hover:opacity-90 disabled:opacity-50"
      >
        {pending ? 'Submitting…' : 'Submit feedback'}
      </button>
    </form>
  );
}

export function FeedbackList({ feedback }: { feedback: FeedbackDto[] }) {
  if (feedback.length === 0) {
    return <p className="py-6 text-center text-[13px] text-muted">No feedback submitted yet.</p>;
  }
  return (
    <ul className="space-y-3">
      {feedback.map((f) => (
        <li key={f.publicId} className="rounded-xl border border-line bg-surface p-4">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[13px] font-semibold text-fg">{f.authorName}</span>
            <span className="mono-label text-[10px] text-faint">
              {f.rating}/5 · {RECOMMENDATION_LABEL[f.recommendation]}
            </span>
          </div>
          <p className="whitespace-pre-wrap text-[13px] text-muted">{f.notes}</p>
        </li>
      ))}
    </ul>
  );
}
