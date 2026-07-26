import type { Difficulty, ProgrammingLanguage, Verdict } from '@code-nexus/types';

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
  EASY: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  MEDIUM: 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400',
  HARD: 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400',
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

/** Minimal stdin/stdout starter templates per language. */
export const STARTER_TEMPLATES: Record<ProgrammingLanguage, string> = {
  PYTHON: `import sys

def main():
    data = sys.stdin.read().split()
    # TODO: read input and print the answer
    print()

main()
`,
  JAVASCRIPT: `const lines = require('fs').readFileSync(0, 'utf8').split('\\n');
// TODO: read input and print the answer
console.log();
`,
  CPP: `#include <bits/stdc++.h>
using namespace std;

int main() {
    // TODO: read from stdin, print to stdout
    return 0;
}
`,
  JAVA: `import java.util.*;
import java.io.*;

public class Main {
    public static void main(String[] args) throws IOException {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
        // TODO: read input and print the answer
    }
}
`,
};
