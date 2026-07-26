import type { Difficulty } from '@code-nexus/types';
import { DIFFICULTY_STYLES } from '../../lib/arena.ts';

const LABEL: Record<Difficulty, string> = { EASY: 'Easy', MEDIUM: 'Medium', HARD: 'Hard' };

export function DifficultyBadge({ difficulty }: { difficulty: Difficulty }) {
  return (
    <span
      className={`mono-label rounded-full border px-2 py-0.5 text-[9px] ${DIFFICULTY_STYLES[difficulty]}`}
    >
      {LABEL[difficulty]}
    </span>
  );
}
