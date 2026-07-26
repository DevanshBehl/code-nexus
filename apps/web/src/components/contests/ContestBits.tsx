import { useEffect, useState } from 'react';
import type { ContestPhase, LeaderboardEntry } from '@code-nexus/types';
import { PHASE_LABEL, PHASE_STYLE, countdown } from '../../lib/contests.ts';

export function ContestPhaseBadge({ phase }: { phase: ContestPhase }) {
  return (
    <span className={`mono-label rounded-full border px-2 py-0.5 text-[9px] ${PHASE_STYLE[phase]}`}>
      {phase === 'open' ? '● ' : ''}
      {PHASE_LABEL[phase]}
    </span>
  );
}

/** Ticking countdown to a target time; calls onElapsed once when it hits zero. */
export function Countdown({ target, onElapsed }: { target: string; onElapsed?: () => void }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const remaining = new Date(target).getTime() - Date.now();
  useEffect(() => {
    if (remaining <= 0) onElapsed?.();
  }, [remaining <= 0, onElapsed]); // eslint-disable-line react-hooks/exhaustive-deps
  return <span className="font-mono tabular-nums">{countdown(target)}</span>;
}

export function LeaderboardTable({
  entries,
  questionSlugs,
}: {
  entries: LeaderboardEntry[];
  questionSlugs: string[];
}) {
  if (entries.length === 0) {
    return <p className="py-8 text-center text-[13px] text-muted">No submissions yet.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[36rem] border-collapse text-left">
        <thead>
          <tr className="border-b border-line">
            <th className="mono-label px-3 py-2 text-[10px] text-faint">#</th>
            <th className="mono-label px-3 py-2 text-[10px] text-faint">Participant</th>
            <th className="mono-label px-3 py-2 text-[10px] text-faint">Score</th>
            <th className="mono-label px-3 py-2 text-[10px] text-faint">Solved</th>
            {questionSlugs.map((_, i) => (
              <th key={i} className="mono-label px-2 py-2 text-center text-[10px] text-faint">
                Q{i + 1}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr
              key={e.studentPublicId}
              className="border-b border-line last:border-0 hover:bg-surface-2"
            >
              <td className="px-3 py-2.5 text-[13px] font-semibold text-fg">{e.rank}</td>
              <td className="px-3 py-2.5 text-[13px] text-fg">{e.displayName}</td>
              <td className="px-3 py-2.5 text-[13px] font-medium text-fg">{e.score}</td>
              <td className="px-3 py-2.5 text-[13px] text-muted">{e.solved}</td>
              {questionSlugs.map((slug) => {
                const pq = e.perQuestion.find((p) => p.slug === slug);
                return (
                  <td key={slug} className="px-2 py-2.5 text-center text-[12px]">
                    {pq?.solved ? (
                      <span className="text-emerald-500">✓</span>
                    ) : pq && pq.bestTestsPassed > 0 ? (
                      <span className="text-amber-500">{pq.bestTestsPassed}</span>
                    ) : (
                      <span className="text-faint">–</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
