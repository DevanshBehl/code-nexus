import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { QuestionDetail } from '@code-nexus/types';
import { starterCodeFor, STARTER_TEMPLATES } from '../../lib/arena.ts';
import { Markdown } from './Markdown.tsx';
import { ProblemStatement } from './ProblemStatement.tsx';
import { ResultPanel } from './ResultPanel.tsx';

const question: QuestionDetail = {
  slug: 'two-sum-indices',
  title: 'Two Sum',
  description: 'Find the two positions that add up to `target`.\n\n**Input**\n\nThe first line…',
  constraints: '2 <= n <= 10^4\n-10^9 <= target <= 10^9',
  difficulty: 'EASY',
  topic: 'HASHMAP',
  starterCode: { PYTHON: 'def solve(nums, target):\n    pass\n' },
  sampleTestCases: [{ input: '4\n2 7 11 15\n9', expectedOutput: '0 1' }],
  status: 'unsolved',
};

describe('Markdown', () => {
  it('renders structure rather than a wall of text', () => {
    render(
      <Markdown>{'**Input**\n\nA line with `n`.\n\n- first\n- second\n\n```\n2 7\n```'}</Markdown>,
    );
    expect(screen.getByText('Input').tagName).toBe('STRONG');
    expect(screen.getByText('n').tagName).toBe('CODE');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('2 7').tagName).toBe('PRE');
  });

  it('keeps markdown inside a code fence literal', () => {
    render(<Markdown>{'```\n**not bold**\n```'}</Markdown>);
    expect(screen.getByText('**not bold**')).toBeInTheDocument();
    expect(screen.queryByText('not bold')).toBeNull();
  });
});

describe('ProblemStatement', () => {
  it('leads with the problem and shows its examples and constraints', () => {
    render(<ProblemStatement question={question} label="A" />);
    expect(screen.getByRole('heading', { name: /Two Sum/ })).toBeInTheDocument();
    // The contest letter is part of the title, so the tab strip and the
    // statement always agree on what problem this is.
    expect(screen.getByRole('heading', { name: /A\./ })).toBeInTheDocument();
    expect(screen.getByText('Example 1')).toBeInTheDocument();
    expect(screen.getByText(/2 7 11 15/)).toBeInTheDocument();
    expect(screen.getByText('0 1')).toBeInTheDocument();
    // Each constraint is its own line, not one run-on paragraph.
    expect(screen.getByText('2 <= n <= 10^4')).toBeInTheDocument();
    expect(screen.getByText('-10^9 <= target <= 10^9')).toBeInTheDocument();
  });
});

describe('starterCodeFor', () => {
  it("prefers the problem's own stub, and falls back per language", () => {
    expect(starterCodeFor(question, 'PYTHON')).toContain('def solve(nums, target)');
    // No Java stub on this problem — the generic scaffold still gives a student
    // a program that compiles and reads stdin.
    expect(starterCodeFor(question, 'JAVA')).toBe(STARTER_TEMPLATES.JAVA);
    expect(starterCodeFor(undefined, 'CPP')).toBe(STARTER_TEMPLATES.CPP);
  });
});

describe('ResultPanel', () => {
  const base = {
    publicId: 's1',
    kind: 'SUBMIT' as const,
    language: 'PYTHON' as const,
    status: 'DONE' as const,
    testsPassed: 3,
    testsTotal: 8,
    failedTestIndex: 4,
    runtimeMs: 42,
    memoryKb: 20480,
    stdout: null,
    stderr: null,
    compileOutput: null,
    createdAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
  };

  it('says how far a failing submission got', () => {
    render(<ResultPanel sub={{ ...base, verdict: 'WRONG_ANSWER' }} pending={false} started />);
    expect(screen.getByText('Wrong Answer')).toBeInTheDocument();
    expect(screen.getByText(/3\/8 testcases passed/)).toBeInTheDocument();
    expect(screen.getByText(/failed on test 4/)).toBeInTheDocument();
    expect(screen.getByText('42 ms')).toBeInTheDocument();
  });

  it('does not report a testcase count for code that never compiled', () => {
    render(
      <ResultPanel
        sub={{
          ...base,
          verdict: 'COMPILATION_ERROR',
          testsPassed: 0,
          compileOutput: 'line 3: expected ;',
        }}
        pending={false}
        started
      />,
    );
    expect(screen.getByText('Compilation Error')).toBeInTheDocument();
    expect(screen.queryByText(/testcases passed/)).toBeNull();
    expect(screen.getByText('line 3: expected ;')).toBeInTheDocument();
  });

  it('waits quietly while the judge is still working', () => {
    render(<ResultPanel pending started />);
    expect(screen.getByText(/Queued/)).toBeInTheDocument();
  });
});
