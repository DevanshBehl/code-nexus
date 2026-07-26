import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, Plus, Search, X } from 'lucide-react';
import type {
  InterviewQuestion,
  InterviewQuestionBankItem,
  InterviewQuestionBankResponse,
} from '@code-nexus/types';
import { api, ApiError } from '../../lib/api.ts';
import { interviewKeys } from '../../lib/interviews.ts';

const DIFFICULTY_STYLE: Record<string, string> = {
  EASY: 'text-emerald-500',
  MEDIUM: 'text-amber-500',
  HARD: 'text-red-500',
};

/**
 * The question surface of the interview room. The candidate sees whatever the
 * interviewer pinned (statement + samples, never hidden testcases); the
 * interviewer additionally gets a live search over the Code Nexus question bank.
 * Picking one persists it on the interview and pushes it to the candidate over
 * the gateway — so it appears on their screen without a refresh.
 */
export function QuestionPanel({
  publicId,
  question,
  canPick,
}: {
  publicId: string;
  question: InterviewQuestion | null;
  canPick: boolean;
}) {
  const [picking, setPicking] = useState(false);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
        <h2 className="text-[13px] font-semibold text-white">Question</h2>
        {canPick ? (
          <button
            type="button"
            onClick={() => setPicking((p) => !p)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-2.5 py-1 text-[12px] font-medium text-white/80 hover:bg-white/10"
          >
            {picking ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
            {picking ? 'Close bank' : question ? 'Change' : 'Add question'}
          </button>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {picking ? (
          <QuestionBank
            publicId={publicId}
            activeSlug={question?.slug ?? null}
            onPicked={() => setPicking(false)}
          />
        ) : question ? (
          <QuestionBody question={question} />
        ) : (
          <p className="px-4 py-8 text-center text-[13px] text-white/45">
            {canPick
              ? 'No question pinned yet. Add one from the bank — the candidate sees it instantly.'
              : 'Your interviewer has not shared a question yet.'}
          </p>
        )}
      </div>
    </div>
  );
}

function QuestionBody({ question }: { question: InterviewQuestion }) {
  return (
    <article className="space-y-4 px-4 py-4">
      <header>
        <h3 className="text-[15px] font-semibold text-white">{question.title}</h3>
        <p className="mono-label mt-1 text-[10px] text-white/40">
          <span className={DIFFICULTY_STYLE[question.difficulty]}>{question.difficulty}</span> ·{' '}
          {question.topic.replace(/_/g, ' ')}
        </p>
      </header>
      <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-white/75">
        {question.description}
      </p>
      {question.constraints ? (
        <section>
          <h4 className="mono-label mb-1 text-[10px] text-white/40">Constraints</h4>
          <p className="whitespace-pre-wrap font-mono text-[12px] text-white/65">
            {question.constraints}
          </p>
        </section>
      ) : null}
      {question.sampleTestCases.length > 0 ? (
        <section className="space-y-2">
          <h4 className="mono-label text-[10px] text-white/40">Examples</h4>
          {question.sampleTestCases.map((t, i) => (
            <div key={i} className="rounded-lg border border-white/10 bg-black/30 p-3">
              <p className="mono-label mb-1 text-[9px] text-white/35">Input</p>
              <pre className="whitespace-pre-wrap font-mono text-[12px] text-white/80">
                {t.input}
              </pre>
              <p className="mono-label mb-1 mt-2 text-[9px] text-white/35">Expected</p>
              <pre className="whitespace-pre-wrap font-mono text-[12px] text-white/80">
                {t.expectedOutput}
              </pre>
            </div>
          ))}
        </section>
      ) : null}
    </article>
  );
}

/** Interviewer-only: search the bank and pin a problem onto the live room. */
function QuestionBank({
  publicId,
  activeSlug,
  onPicked,
}: {
  publicId: string;
  activeSlug: string | null;
  onPicked: () => void;
}) {
  const qc = useQueryClient();
  const [term, setTerm] = useState('');
  const [error, setError] = useState<string | null>(null);

  const bank = useQuery({
    queryKey: [...interviewKeys.bank(publicId), term],
    queryFn: () =>
      api.get<InterviewQuestionBankResponse>(
        `/interviews/${publicId}/question-bank${term ? `?q=${encodeURIComponent(term)}` : ''}`,
      ),
  });

  const pick = useMutation({
    mutationFn: (slug: string) => api.post(`/interviews/${publicId}/question`, { slug }),
    onSuccess: () => {
      setError(null);
      // The gateway pushes the question to every peer; refresh the record too so a
      // reload (or a peer who is not connected yet) sees the same thing.
      void qc.invalidateQueries({ queryKey: interviewKeys.detail(publicId) });
      onPicked();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not set the question'),
  });

  return (
    <div className="px-4 py-3">
      <label className="relative mb-3 block">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/35"
          aria-hidden="true"
        />
        <input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Search the question bank…"
          aria-label="Search the question bank"
          className="w-full rounded-lg border border-white/15 bg-black/30 py-2 pl-9 pr-3 text-[13px] text-white placeholder:text-white/35 focus:border-white/35 focus:outline-none"
        />
      </label>

      {error ? <p className="mb-2 text-[12px] text-red-400">{error}</p> : null}

      {bank.isLoading ? (
        <p className="py-6 text-center text-[13px] text-white/45">Loading questions…</p>
      ) : bank.isError ? (
        <p className="py-6 text-center text-[13px] text-red-400">Could not load the bank.</p>
      ) : bank.data && bank.data.items.length > 0 ? (
        <ul className="space-y-1.5">
          {bank.data.items.map((q: InterviewQuestionBankItem) => (
            <li key={q.slug}>
              <button
                type="button"
                disabled={pick.isPending}
                onClick={() => pick.mutate(q.slug)}
                className="flex w-full items-center justify-between gap-3 rounded-lg border border-white/10 px-3 py-2 text-left hover:bg-white/10 disabled:opacity-50"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[13px] text-white">{q.title}</span>
                  <span className="mono-label text-[9px] text-white/40">
                    <span className={DIFFICULTY_STYLE[q.difficulty]}>{q.difficulty}</span> ·{' '}
                    {q.topic.replace(/_/g, ' ')}
                  </span>
                </span>
                {pick.isPending && pick.variables === q.slug ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-white/60" />
                ) : q.slug === activeSlug ? (
                  <Check className="h-4 w-4 shrink-0 text-emerald-400" aria-label="Pinned" />
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="py-6 text-center text-[13px] text-white/45">
          No questions match that search.
        </p>
      )}
    </div>
  );
}
