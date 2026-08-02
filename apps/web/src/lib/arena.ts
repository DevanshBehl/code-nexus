import type { Difficulty, ProgrammingLanguage, QuestionDetail, Verdict } from '@code-nexus/types';

/** Query keys + display metadata for the Phase 6 Code Arena UI. */

export const arenaKeys = {
  questions: (params: string) => ['arena', 'questions', params] as const,
  question: (slug: string) => ['arena', 'question', slug] as const,
  submission: (publicId: string) => ['arena', 'submission', publicId] as const,
  submissions: (slug: string) => ['arena', 'submissions', slug] as const,
  heatmap: (year: number) => ['arena', 'heatmap', year] as const,
  stats: ['arena', 'stats'] as const,
};

export const DIFFICULTY_STYLES: Record<Difficulty, string> = {
  EASY: 'border-success-line bg-success-soft text-success',
  MEDIUM: 'border-warn-line bg-warn-soft text-warn',
  HARD: 'border-danger-line bg-danger-soft text-danger',
};

export const VERDICT_LABELS: Record<Verdict, string> = {
  ACCEPTED: 'Accepted',
  WRONG_ANSWER: 'Wrong Answer',
  TIME_LIMIT_EXCEEDED: 'Time Limit Exceeded',
  RUNTIME_ERROR: 'Runtime Error',
  COMPILATION_ERROR: 'Compilation Error',
  INTERNAL_ERROR: 'Internal Error',
};

export function isAccepted(v: Verdict | null): boolean {
  return v === 'ACCEPTED';
}

/** Colour + label for a verdict pill, used in lists and history rows. */
export const VERDICT_STYLES: Record<Verdict, string> = {
  ACCEPTED: 'border-success-line bg-success-soft text-success',
  WRONG_ANSWER: 'border-danger-line bg-danger-soft text-danger',
  TIME_LIMIT_EXCEEDED: 'border-warn-line bg-warn-soft text-warn',
  RUNTIME_ERROR: 'border-danger-line bg-danger-soft text-danger',
  COMPILATION_ERROR: 'border-warn-line bg-warn-soft text-warn',
  INTERNAL_ERROR: 'border-line bg-surface-2 text-muted',
};

export function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** "2m ago" — submission lists are read as a sequence, not as timestamps. */
export function timeAgo(iso: string): string {
  const secs = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

/**
 * The code you land on when you open a problem.
 *
 * This platform judges on stdin/stdout, so a template cannot be the bare
 * `class Solution` stub of a site that calls your function for you — the program
 * has to read its own input. What it CAN do, and what these do, is take that
 * plumbing off the student's hands: parsing is written, printing is written, and
 * the only thing left is a `solve` function with the signature the problem
 * describes. That is the same shape of work as a LeetCode stub — write the
 * algorithm, not the boilerplate — without lying about how the judge runs.
 *
 * These are the FALLBACK, used when a problem ships no starter code of its own.
 * A problem's own `starterCode` is per-language and knows its input format, so it
 * always wins; see the seeded questions for what a good one looks like.
 */
export const STARTER_TEMPLATES: Record<ProgrammingLanguage, string> = {
  PYTHON: `import sys

def solve(data: list[str]) -> None:
    """Write your solution here. \`data\` is every whitespace-separated token
    from stdin. Print the answer with print()."""
    pass


def main() -> None:
    data = sys.stdin.read().split()
    solve(data)


if __name__ == "__main__":
    main()
`,
  JAVASCRIPT: `/**
 * Write your solution here. \`data\` is every whitespace-separated token from
 * stdin. Print the answer with console.log().
 */
function solve(data) {
  // your code goes here
}

const data = require('fs').readFileSync(0, 'utf8').split(/\\s+/).filter(Boolean);
solve(data);
`,
  CPP: `#include <bits/stdc++.h>
using namespace std;

// Write your solution here. Read from cin, print to cout.
void solve() {
    // your code goes here
}

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    solve();
    return 0;
}
`,
  JAVA: `import java.util.*;
import java.io.*;

public class Main {
    // Write your solution here. Read from \`in\`, print with System.out.
    static void solve(BufferedReader in) throws IOException {
        // your code goes here
    }

    public static void main(String[] args) throws IOException {
        BufferedReader in = new BufferedReader(new InputStreamReader(System.in));
        solve(in);
    }
}
`,
};

/**
 * The starter code for a problem in a language: the problem's own if it has one,
 * otherwise the generic scaffold. One place decides this, because "which code do
 * I start from" must be the same answer in the arena, in a contest, and in an
 * interview — and Reset has to restore exactly what you were given.
 */
export function starterCodeFor(
  question: Pick<QuestionDetail, 'starterCode'> | undefined,
  language: ProgrammingLanguage,
): string {
  return question?.starterCode?.[language] ?? STARTER_TEMPLATES[language];
}
