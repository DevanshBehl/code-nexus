import { CheckCircle2, Clock, Cpu, Loader2, Terminal, XCircle } from 'lucide-react';
import type { SubmissionDto } from '@code-nexus/types';
import { VERDICT_LABELS, isAccepted } from '../../lib/arena.ts';

/**
 * What the judge said, rendered the same way everywhere code can be run.
 *
 * A verdict is the moment the whole surface exists for, so it leads with the one
 * thing the person wants — accepted or not — and then answers the question that
 * always comes next: how far did it get before it broke. `testsPassed / total`
 * with the failing index is exactly the trail of breadcrumbs a competitive judge
 * gives, and it is the difference between "wrong answer" and "wrong answer on
 * the empty-array case".
 *
 * Hidden testcases stay hidden: a failing SUBMIT reports the index and nothing
 * else, because the input is the answer to a problem the student is being asked
 * to solve. A RUN is against the samples, which they can already see, so its
 * output is shown in full.
 */
export function ResultPanel({
  sub,
  pending,
  error,
  started,
  emptyHint,
}: {
  sub?: SubmissionDto;
  /** Queued or running — the judge has it, we are waiting. */
  pending: boolean;
  /** The request never reached the judge (rate limit, network, closed contest). */
  error?: string;
  /** Whether anything has been submitted at all in this sitting. */
  started: boolean;
  emptyHint?: string;
}) {
  if (error) {
    return (
      <p className="rounded-lg border border-danger-line bg-danger-soft px-3 py-2 text-[13px] text-danger">
        {error}
      </p>
    );
  }
  if (!started) {
    return (
      <p className="flex items-center gap-2 text-[13px] text-muted">
        <Terminal className="h-4 w-4 text-faint" aria-hidden="true" />
        {emptyHint ?? 'Run against the samples, or Submit to run every testcase.'}
      </p>
    );
  }
  if (pending) {
    return (
      <p className="inline-flex items-center gap-2 text-[13px] text-muted">
        <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        {sub?.status === 'RUNNING' ? 'Running your code…' : 'Queued…'}
      </p>
    );
  }
  if (!sub) return null;
  if (sub.status === 'ERROR') {
    return (
      <p className="inline-flex items-center gap-2 text-[13px] text-danger">
        <XCircle className="h-4 w-4" aria-hidden="true" /> Execution failed — the judge may be
        unavailable. Try again.
      </p>
    );
  }

  const ok = isAccepted(sub.verdict);
  const compiled = sub.verdict !== 'COMPILATION_ERROR';
  return (
    <div className="space-y-4">
      <div
        className={`rounded-xl border px-3.5 py-3 ${
          ok ? 'border-success-line bg-success-soft' : 'border-danger-line bg-danger-soft'
        }`}
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span
            className={`inline-flex items-center gap-2 text-[15px] font-semibold ${
              ok ? 'text-success' : 'text-danger'
            }`}
          >
            {ok ? (
              <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
            ) : (
              <XCircle className="h-5 w-5" aria-hidden="true" />
            )}
            {sub.verdict ? VERDICT_LABELS[sub.verdict] : '—'}
          </span>
          {compiled ? (
            <span className="text-[13px] text-muted">
              {sub.testsPassed}/{sub.testsTotal} testcases passed
              {!ok && sub.failedTestIndex ? ` · failed on test ${sub.failedTestIndex}` : ''}
            </span>
          ) : null}
          <span className="ml-auto flex flex-wrap items-center gap-3 text-[12px] text-faint">
            {sub.runtimeMs != null ? (
              <span className="inline-flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" aria-hidden="true" /> {sub.runtimeMs} ms
              </span>
            ) : null}
            {sub.memoryKb != null ? (
              <span className="inline-flex items-center gap-1.5">
                <Cpu className="h-3.5 w-3.5" aria-hidden="true" /> {Math.round(sub.memoryKb / 1024)}{' '}
                MB
              </span>
            ) : null}
          </span>
        </div>
        {compiled && sub.testsTotal > 0 ? <TestProgress sub={sub} ok={ok} /> : null}
      </div>

      {sub.compileOutput ? (
        <OutputBlock label="Compiler output" tone="error" value={sub.compileOutput} />
      ) : null}
      {sub.kind === 'RUN' && sub.stdout != null ? (
        <OutputBlock label="Your output" value={sub.stdout || '(no output)'} />
      ) : null}
      {sub.stderr ? <OutputBlock label="Stderr" tone="warn" value={sub.stderr} /> : null}
    </div>
  );
}

/**
 * The testcase strip: one cell per case, filled up to the point it broke. The
 * count is already stated above — this is for the glance, not the reading.
 */
function TestProgress({ sub, ok }: { sub: SubmissionDto; ok: boolean }) {
  // Beyond a couple of dozen cells this stops being legible and becomes noise;
  // a bar carries the same information at any length.
  if (sub.testsTotal > 24) {
    const pct = Math.round((sub.testsPassed / sub.testsTotal) * 100);
    return (
      <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div
          className={`h-full rounded-full ${ok ? 'bg-success-solid' : 'bg-danger-solid'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    );
  }
  return (
    <div className="mt-2.5 flex flex-wrap gap-1" aria-hidden="true">
      {Array.from({ length: sub.testsTotal }, (_, i) => (
        <span
          key={i}
          title={`Test ${i + 1}`}
          className={`h-1.5 w-6 rounded-full ${
            i < sub.testsPassed
              ? 'bg-success-solid'
              : i === sub.testsPassed && !ok
                ? 'bg-danger-solid'
                : 'bg-line'
          }`}
        />
      ))}
    </div>
  );
}

export function OutputBlock({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'error' | 'warn';
}) {
  const color = tone === 'error' ? 'text-danger' : tone === 'warn' ? 'text-warn' : 'text-fg';
  return (
    <div>
      <p className="mono-label mb-1 text-[9px] text-faint">{label}</p>
      <pre
        className={`max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-surface-2 p-3 font-mono text-[12.5px] ${color}`}
      >
        {value}
      </pre>
    </div>
  );
}
