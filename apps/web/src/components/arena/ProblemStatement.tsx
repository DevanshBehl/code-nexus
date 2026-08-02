import { CheckCircle2, CircleDot } from 'lucide-react';
import type { QuestionDetail } from '@code-nexus/types';
import { titleCase } from '../../lib/arena.ts';
import { DifficultyBadge } from './DifficultyBadge.tsx';
import { Markdown } from './Markdown.tsx';

/**
 * A problem, laid out the way everybody who solves these already reads them:
 * title and difficulty, the statement, then the worked examples, then the
 * constraints. Shared by the arena and the contest arena so a student never has
 * to re-orient mid-contest.
 *
 * `label` is the contest's problem letter (A, B, C…) when there is one. Contest
 * problems are referred to by letter everywhere else — the tab strip, the
 * standings, the conversation afterwards — so the statement has to agree.
 */
export function ProblemStatement({
  question,
  label,
}: {
  question: QuestionDetail;
  label?: string;
}) {
  return (
    <article>
      <header className="mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-[19px] font-semibold tracking-tight text-fg">
            {label ? <span className="text-faint">{label}. </span> : null}
            {question.title}
          </h1>
          {question.status === 'solved' ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-success-line bg-success-soft px-2 py-0.5 text-[10px] font-medium text-success">
              <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> Solved
            </span>
          ) : question.status === 'attempted' ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-warn-line bg-warn-soft px-2 py-0.5 text-[10px] font-medium text-warn">
              <CircleDot className="h-3 w-3" aria-hidden="true" /> Attempted
            </span>
          ) : null}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <DifficultyBadge difficulty={question.difficulty} />
          <span className="mono-label rounded-full border border-line px-2 py-0.5 text-[9px] text-faint">
            {titleCase(question.topic)}
          </span>
        </div>
      </header>

      <Markdown>{question.description}</Markdown>

      {question.sampleTestCases.length > 0 ? (
        <section className="mt-6 space-y-4">
          {question.sampleTestCases.map((t, i) => (
            <div key={i}>
              <p className="mb-2 text-[13px] font-semibold text-fg">Example {i + 1}</p>
              <div className="overflow-hidden rounded-xl border border-line bg-surface-2">
                <IoRow label="Input" value={t.input} />
                <IoRow label="Output" value={t.expectedOutput} bordered />
              </div>
            </div>
          ))}
        </section>
      ) : null}

      {question.constraints ? (
        <section className="mt-6">
          <p className="mb-2 text-[13px] font-semibold text-fg">Constraints</p>
          {/* Constraints are usually a list of inequalities, one per line — each
              is its own fact and reads far better as its own row. */}
          <ul className="space-y-1 pl-5 font-mono text-[12.5px] leading-relaxed text-muted">
            {question.constraints
              .split('\n')
              .map((c) => c.trim())
              .filter(Boolean)
              .map((c, i) => (
                <li key={i} className="list-disc marker:text-faint">
                  {c}
                </li>
              ))}
          </ul>
        </section>
      ) : null}
    </article>
  );
}

function IoRow({ label, value, bordered }: { label: string; value: string; bordered?: boolean }) {
  return (
    <div className={`px-3.5 py-2.5 ${bordered ? 'border-t border-line' : ''}`}>
      <span className="mono-label text-[9px] text-faint">{label}</span>
      <pre className="mt-1 overflow-x-auto whitespace-pre-wrap font-mono text-[12.5px] text-fg">
        {value}
      </pre>
    </div>
  );
}
